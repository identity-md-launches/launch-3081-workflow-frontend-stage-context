import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  copyFile,
} from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toHex } from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));
export const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hashAbi = (abi) =>
  keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
const handoff = await json("web/deployment-handoff.json");
const network = await json("web/network.json");
const check = process.argv.includes("--check");
const dist = join(root, "dist");
await mkdir(join(dist, "abi"), { recursive: true });
for (const c of handoff.contracts) {
  const abiPath = `docs/abi/${c.name}.json`;
  // A pinned git object is the ABI source, even if a working-tree copy later changes.
  let raw;
  try {
    raw = execFileSync("git", ["show", `${handoff.sourceCommit}:${abiPath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Source archives may omit Git metadata. The implementation export is still
    // required and must pass the same attested canonical Keccak binding.
    raw = await readFile(join(root, abiPath), "utf8");
  }
  const abi = JSON.parse(raw);
  if (!Array.isArray(abi) || hashAbi(abi) !== c.abiHash)
    throw new Error(`Pinned ABI hash mismatch: ${c.name}`);
  const exported = join(dist, "abi", `${c.name}.json`);
  if (check) {
    if (hashAbi(JSON.parse(await readFile(exported, "utf8"))) !== c.abiHash)
      throw new Error(`Exported ABI mismatch: ${c.name}`);
  } else await writeFile(exported, raw);
}
async function files(dir) {
  const all = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error("Symlinks are not export assets");
    if (e.isDirectory()) all.push(...(await files(join(dir, e.name))));
    else all.push(join(dir, e.name));
  }
  return all;
}
const assets = [];
for (const p of (await files(dist)).sort()) {
  const path = relative(dist, p).replaceAll("\\", "/");
  if (path === "imd-deployment.json") continue;
  if ((await stat(p)).size > 8388608)
    throw new Error(`Oversize asset: ${path}`);
  assets.push({
    path,
    sha256: createHash("sha256")
      .update(await readFile(p))
      .digest("hex"),
  });
}
if (assets.length > 128) throw new Error("More than 128 assets");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  assets,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  ...network,
};
if (check) {
  const actual = await json("dist/imd-deployment.json");
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(manifest)))
    throw new Error(
      "Manifest differs from pinned handoff, network or asset inventory",
    );
} else
  await writeFile(
    join(dist, "imd-deployment.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
console.log(
  `${check ? "Verified" : "Exported"} ${manifest.contracts.length} pinned ABIs and ${assets.length} asset hashes.`,
);
