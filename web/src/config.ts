import { createConfig, http as wagmiHttp } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  stringToHex,
  erc20Abi,
  parseAbi,
  type Address,
  type Abi,
} from "viem";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number;
    name: string;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: Record<string, Address | boolean>;
    pairToken: { address: Address; symbol: string; decimals: number };
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const USDC: Address = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const tokenAbi = erc20Abi;
export const protocolAbis = {
  quoter: parseAbi([
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  ]),
  stateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  ]),
  permit: parseAbi([
    "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  ]),
  router: parseAbi([
    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  ]),
};
export async function loadRuntime() {
  const base = new URL("./", location.href.split("#")[0]);
  const response = await fetch(new URL("imd-deployment.json", base));
  if (!response.ok)
    throw new Error(
      "Deployment configuration could not be loaded. Reload to retry.",
    );
  const deployment = (await response.json()) as Deployment;
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    !deployment.contracts.length
  )
    throw new Error(
      "Deployment configuration is inconsistent. Transactions are unavailable.",
    );
  const abis: Record<string, Abi> = {};
  for (const c of deployment.contracts) {
    if (!/^[\w/-]+\.json$/.test(c.abiPath) || c.abiPath.includes(".."))
      throw new Error("Invalid ABI path.");
    const raw = await fetch(new URL(c.abiPath, base));
    if (!raw.ok) throw new Error(`Unable to load the ${c.name} interface.`);
    const abi = await raw.json();
    if (
      !Array.isArray(abi) ||
      keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2) !==
        c.abiHash
    )
      throw new Error(
        `The ${c.name} interface does not match its attestation.`,
      );
    abis[c.name] = abi;
  }
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
  });
  const client = createPublicClient({
    chain,
    transport: fallback(
      deployment.network.rpcUrls.map((url) =>
        http(url, { timeout: 12000, retryCount: 1 }),
      ),
      { rank: false },
    ),
  });
  const wallets = createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected(),
      coinbaseWallet({
        appName: "pIMD Markets",
        preference: { options: "all", telemetry: false },
      }),
    ],
    transports: { [chain.id]: wagmiHttp(deployment.network.rpcUrls[0]) },
  });
  const contract = (name: string) => {
    const c = deployment.contracts.find((c) => c.name === name);
    if (!c) throw new Error(`Missing contract: ${name}`);
    return { address: c.address, abi: abis[name] };
  };
  const read = async (
    name: string,
    functionName: string,
    args: any[] = [],
  ): Promise<any> =>
    client.readContract({ ...contract(name), functionName, args });
  return { deployment, abis, chain, client, wallets, contract, read };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
export const explorer = (rt: Runtime, value: string, type = "address") =>
  `${rt.deployment.network.explorer}/${type}/${value}`;
