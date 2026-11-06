import {
  toRlp,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  type Hex,
} from "viem";
import { useSyncExternalStore } from "react";
import { type Runtime } from "./config";
import { type Asset } from "./domain";
export type BoundaryProof = {
  version: number;
  boundary: bigint;
  proofs: { header: Hex; accountProof: Hex[]; storageProofs: Hex[][] }[];
  price: bigint;
};
const witnesses = new Map<string, BoundaryProof>();
let serial = 0;
const listeners = new Set<() => void>();
export const proofKey = (v: number, b: bigint) => `${v}:${b}`;
export function saveProof(p: BoundaryProof) {
  witnesses.set(proofKey(p.version, p.boundary), p);
  serial++;
  listeners.forEach((l) => l());
}
export function useProof(version: number, boundary: bigint) {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => serial,
  );
  return witnesses.get(proofKey(version, boundary));
}
export const proofArgument = (p: BoundaryProof) => ({
  version: p.version,
  boundary: p.boundary,
  proofs: p.proofs,
});
function rawHeader(b: any): Hex {
  const fields = [
    "parentHash",
    "sha3Uncles",
    "miner",
    "stateRoot",
    "transactionsRoot",
    "receiptsRoot",
    "logsBloom",
    "difficulty",
    "number",
    "gasLimit",
    "gasUsed",
    "timestamp",
    "extraData",
    "mixHash",
    "nonce",
  ];
  const integer = new Set([
    "difficulty",
    "number",
    "gasLimit",
    "gasUsed",
    "timestamp",
    "baseFeePerGas",
    "blobGasUsed",
    "excessBlobGas",
  ]);
  for (const k of [
    "baseFeePerGas",
    "withdrawalsRoot",
    "blobGasUsed",
    "excessBlobGas",
    "parentBeaconBlockRoot",
    "requestsHash",
  ])
    if (b[k] != null) fields.push(k);
  const raw = toRlp(
    fields.map((k) =>
      integer.has(k)
        ? BigInt(b[k]) === 0n
          ? "0x"
          : toHex(BigInt(b[k]))
        : b[k],
    ),
  );
  if (keccak256(raw).toLowerCase() !== b.hash.toLowerCase())
    throw new Error(
      "RPC header hash mismatch. This block format is unsupported or the response changed.",
    );
  return raw;
}
export async function buildBoundaryProof(
  rt: Runtime,
  asset: Asset,
  boundary: bigint,
  progress: (s: string) => void,
): Promise<BoundaryProof> {
  const rpc = (method: string, params: any[]) =>
    rt.client.request({ method, params } as any) as Promise<any>;
  const head = await rt.client.getBlock();
  if (boundary > head.timestamp)
    throw new Error(
      "This boundary is in the future. Wait until at least N+2 and a successor have been mined.",
    );
  if (head.timestamp > boundary + 97200n)
    throw new Error(
      "The 27-hour proof window has closed. Inspect the bonded fallback below.",
    );
  progress("Finding the blocks around this UTC boundary…");
  let low = 0n,
    high = head.number;
  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    const block = await rpc("eth_getBlockByNumber", [toHex(mid), false]);
    if (BigInt(block.timestamp) <= boundary) low = mid;
    else high = mid;
  }
  if (low + 2n >= head.number)
    throw new Error(
      "Wait for N+2 and a successor block before building this proof.",
    );
  const slots = asset.path.slice(0, asset.hops).map((k) => {
    const pool = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
        ),
        [k],
      ),
    );
    return keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [pool, 6n]),
    );
  });
  const proofs = [];
  const blocks = [];
  for (let i = 0; i < 3; i++) {
    progress(
      `Reading Ethereum account and storage proofs: block ${i + 1} of 3…`,
    );
    const n = low + BigInt(i);
    const block = await rpc("eth_getBlockByNumber", [toHex(n), false]);
    const proof = await rpc("eth_getProof", [
      rt.deployment.network.uniswapV4.poolManager,
      slots,
      toHex(n),
    ]);
    if (!proof?.accountProof || proof.storageProof?.length !== slots.length)
      throw new Error(
        "This public RPC did not return complete historical proofs. Try the next configured RPC or import a witness.",
      );
    blocks.push(block);
    proofs.push({
      header: rawHeader(block),
      accountProof: proof.accountProof,
      storageProofs: slots.map((s) => {
        const entry = proof.storageProof.find(
          (p: any) => BigInt(p.key) === BigInt(s),
        );
        if (!entry) throw new Error("RPC omitted a requested storage proof.");
        return entry.proof;
      }),
    });
  }
  if (
    !(
      BigInt(blocks[0].timestamp) <= boundary &&
      BigInt(blocks[1].timestamp) > boundary
    )
  )
    throw new Error("The block window does not bracket the boundary.");
  if (
    (await rpc("eth_getBlockByNumber", [toHex(low + 2n), false])).hash !==
    blocks[2].hash
  )
    throw new Error(
      "The chain reorganized while the proof was built. Rebuild it.",
    );
  progress("Validating the proof against the deployed verifier…");
  const price = await rt.read("BoundaryProofVerifier", "verify", [
    boundary,
    asset,
    proofs,
  ]);
  const result = { version: asset.version, boundary, proofs, price };
  saveProof(result);
  return result;
}
export async function importBoundaryProof(
  rt: Runtime,
  asset: Asset,
  boundary: bigint,
  raw: string,
) {
  const value = JSON.parse(raw);
  if (Number(value.boundary) !== Number(boundary))
    throw new Error(
      "Imported boundary does not match the selected UTC timestamp.",
    );
  if (value.chainId !== undefined && value.chainId !== rt.chain.id)
    throw new Error("Imported witness is for a different chain.");
  const proofs = value.proofs?.map((p: any) => ({
    header: p.header,
    accountProof: p.accountProof,
    storageProofs: p.storageProofs,
  }));
  if (proofs?.length !== 3)
    throw new Error("A witness needs exactly three block proofs.");
  const price = await rt.read("BoundaryProofVerifier", "verify", [
    boundary,
    asset,
    proofs,
  ]);
  const result = { version: asset.version, boundary, proofs, price };
  saveProof(result);
  return result;
}
