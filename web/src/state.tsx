import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useAccount } from "wagmi";
import { getAccount, getWalletClient } from "@wagmi/core";
import { erc20Abi, type Hex, type Address } from "viem";
import { type Runtime, USDC, ZERO, protocolAbis } from "./config";
import { type Asset, type Period, type Market, friendly } from "./domain";

export type Snapshot = {
  verified: boolean;
  loaded: boolean;
  error: string;
  assets: Asset[];
  periods: Period[];
  markets: Market[];
  owner: Address;
  head: bigint;
  timestamp: number;
  prices: Record<number, { boundary: bigint; price: bigint }>;
  balances: Record<string, { wallet: bigint; free: bigint; allowance: bigint }>;
  positions: Record<string, { up: bigint; down: bigint }>;
  marketTotal: number;
};
const initial: Snapshot = {
  verified: false,
  loaded: false,
  error: "",
  assets: [],
  periods: [],
  markets: [],
  owner: ZERO,
  head: 0n,
  timestamp: Math.floor(Date.now() / 1000),
  prices: {},
  balances: {},
  positions: {},
  marketTotal: 0,
};
export type Tx = {
  label: string;
  phase:
    | "review"
    | "simulating"
    | "signing"
    | "pending"
    | "confirmed"
    | "error";
  hash?: Hex;
  error?: string;
  details: string;
  submit: () => Promise<void>;
};
type State = {
  rt: Runtime;
  data: Snapshot;
  refresh: () => Promise<void>;
  busy: boolean;
  tx: Tx | null;
  setTx: (t: Tx | null) => void;
  send: (
    name: string,
    fn: string,
    args: any[],
    label: string,
    details: string,
    value?: bigint,
  ) => void;
  approve: (
    token: Address,
    spender: Address,
    n: bigint,
    symbol: string,
  ) => void;
  walletOpen: boolean;
  setWalletOpen: (open: boolean) => void;
  marketLimit: number;
  loadMarkets: () => void;
};
const Context = createContext<State>(null!);
export const useApp = () => useContext(Context);
export function AppProvider({
  rt,
  children,
}: {
  rt: Runtime;
  children: ReactNode;
}) {
  const account = useAccount();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Tx | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [marketLimit, setMarketLimit] = useState(100);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    try {
      if ((await rt.client.getChainId()) !== rt.deployment.chainId)
        throw new Error(
          "The configured RPC returned a different chain. Trading is disabled.",
        );
      const codes = await Promise.all(
        rt.deployment.contracts.map((c) =>
          rt.client.getCode({ address: c.address }),
        ),
      );
      if (codes.some((c) => !c || c === "0x"))
        throw new Error(
          "A deployed contract has no code at the configured RPC. Trading is disabled.",
        );
      const [ac, pc, mc, owner, block] = await Promise.all([
        rt.read("PimdRegistry", "assetCount"),
        rt.read("PimdRegistry", "periodCount"),
        rt.read("PimdMarkets", "marketCount"),
        rt.read("PimdRegistry", "owner"),
        rt.client.getBlock(),
      ]);
      const assets: Asset[] = await Promise.all(
        Array.from({ length: Number(ac) }, async (_, i) => {
          const token = await rt.read("PimdRegistry", "assets", [BigInt(i)]);
          const version = await rt.read("PimdRegistry", "currentVersion", [
            token,
          ]);
          const a = await rt.read("PimdRegistry", "asset", [version]);
          const [symbol, decimals] = await Promise.all([
            rt.client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "symbol",
            }),
            rt.client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "decimals",
            }),
          ]);
          return { ...a, version, symbol, decimals };
        }),
      );
      const periods: Period[] = await Promise.all(
        Array.from({ length: Number(pc) }, async (_, id) => {
          const [secondsPerRound, offset, calendarMonth] = await rt.read(
            "PimdRegistry",
            "periods",
            [BigInt(id)],
          );
          return {
            id,
            secondsPerRound,
            offset,
            calendarMonth,
            label: calendarMonth
              ? "Monthly"
              : secondsPerRound === 3600
                ? "Hourly"
                : secondsPerRound === 86400
                  ? "Daily"
                  : secondsPerRound === 604800
                    ? "Weekly"
                    : `${secondsPerRound / 3600} hours`,
          };
        }),
      );
      const count = Number(mc);
      const markets: Market[] = await Promise.all(
        Array.from({ length: Math.min(count, marketLimit) }, async (_, i) => {
          const id = await rt.read("PimdMarkets", "marketIds", [
            BigInt(count - 1 - i),
          ]);
          return { id, ...(await rt.read("PimdMarkets", "market", [id])) };
        }),
      );
      const prices: Snapshot["prices"] = {};
      await Promise.all(
        [
          ...new Set([
            ...assets.map((a) => a.version),
            ...markets.map((m) => m.version),
          ]),
        ].map(async (version) => {
          const boundary = await rt.read("BoundaryOracle", "latestBoundary", [
            version,
          ]);
          const price = await rt.read("BoundaryOracle", "price", [
            version,
            boundary,
          ]);
          prices[version] = { boundary, price };
        }),
      );
      const balances: Snapshot["balances"] = {};
      const positions: Snapshot["positions"] = {};
      if (account.address) {
        await Promise.all(
          [USDC, ...new Set(assets.map((a) => a.token))].map(async (token) => {
            const [w, f, a] = await Promise.all([
              rt.client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address!],
              }),
              rt.read("PimdMarkets", "balance", [account.address, token]),
              rt.client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: "allowance",
                args: [account.address!, rt.contract("PimdMarkets").address],
              }),
            ]);
            balances[token.toLowerCase()] = {
              wallet: w,
              free: f,
              allowance: a,
            };
          }),
        );
        await Promise.all(
          markets.map(async (m) => {
            const [up, down] = await rt.read("PimdMarkets", "positions", [
              m.id,
              account.address,
            ]);
            positions[m.id] = { up, down };
          }),
        );
      }
      if (
        sequence !== refreshSequence.current ||
        getAccount(rt.wallets).address?.toLowerCase() !==
          account.address?.toLowerCase()
      )
        return;
      setData({
        verified: true,
        loaded: true,
        error: "",
        assets,
        periods,
        markets,
        owner,
        head: block.number,
        timestamp: Number(block.timestamp),
        prices,
        balances,
        positions,
        marketTotal: count,
      });
    } catch (error) {
      if (sequence === refreshSequence.current)
        setData((d) => ({ ...d, verified: false, error: friendly(error) }));
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [rt, account.address, marketLimit]);
  useEffect(() => {
    setData((previous) => ({ ...previous, balances: {}, positions: {} }));
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);
  const send = useCallback(
    (
      name: string,
      fn: string,
      args: any[],
      label: string,
      details: string,
      value = 0n,
    ) => {
      if (!account.address) {
        setWalletOpen(true);
        return;
      }
      const submit = async () => {
        try {
          const current = getAccount(rt.wallets);
          if (current.address?.toLowerCase() !== account.address?.toLowerCase())
            throw new Error(
              "The connected wallet changed. Close this review and start the action again.",
            );
          if (current.chainId !== rt.chain.id)
            throw new Error(
              `Switch your wallet to ${rt.chain.name} before continuing.`,
            );
          const wallet = await getWalletClient(rt.wallets, {
            chainId: rt.chain.id,
          });
          if (!data.verified)
            throw new Error(
              "Deployment verification is required. Refresh the connection.",
            );
          if ((await wallet.getChainId()) !== rt.chain.id)
            throw new Error(`Switch your wallet to ${rt.chain.name}.`);
          setTx((t) =>
            t ? { ...t, phase: "simulating", error: undefined } : t,
          );
          const contract = name.startsWith("ERC20:")
            ? { address: name.slice(6) as Address, abi: erc20Abi }
            : name.startsWith("PERMIT2:")
              ? { address: name.slice(8) as Address, abi: protocolAbis.permit }
              : name.startsWith("ROUTER:")
                ? {
                    address: name.slice(7) as Address,
                    abi: protocolAbis.router,
                  }
                : rt.contract(name);
          const simulation = await rt.client.simulateContract({
            ...contract,
            functionName: fn,
            args,
            account: account.address,
            value,
          });
          setTx((t) => (t ? { ...t, phase: "signing" } : t));
          const hash = await wallet.writeContract({
            ...simulation.request,
            chain: rt.chain,
            account: account.address!,
          } as any);
          setTx((t) => (t ? { ...t, phase: "pending", hash } : t));
          const receipt = await rt.client.waitForTransactionReceipt({
            hash,
            confirmations: 1,
            timeout: 180000,
          });
          if (receipt.status !== "success")
            throw new Error(
              "The transaction reverted. Review the explorer receipt before trying again.",
            );
          setTx((t) => (t ? { ...t, phase: "confirmed" } : t));
          void refresh();
        } catch (error) {
          setTx((t) =>
            t ? { ...t, phase: "error", error: friendly(error) } : t,
          );
        }
      };
      setTx({ label, details, phase: "review", submit });
    },
    [account.address, account.chainId, data.verified, rt, refresh],
  );
  const approve = (
    token: Address,
    spender: Address,
    n: bigint,
    symbol: string,
  ) =>
    send(
      `ERC20:${token}`,
      "approve",
      [spender, n],
      `Approve ${symbol}`,
      `Allow ${spender} to spend exactly ${n.toString()} atomic units of ${symbol}. This approval does not deposit or trade your tokens.`,
    );
  return (
    <Context.Provider
      value={{
        rt,
        data,
        refresh,
        busy,
        tx,
        setTx,
        send,
        approve,
        walletOpen,
        setWalletOpen,
        marketLimit,
        loadMarkets: () => setMarketLimit((n) => n + 100),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useMarketPosition(id: Hex | undefined) {
  const { rt, data } = useApp();
  const account = useAccount();
  const [position, setPosition] = useState<{ up: bigint; down: bigint }>();
  useEffect(() => {
    let stale = false;
    setPosition(undefined);
    if (id && account.address && data.verified)
      void rt
        .read("PimdMarkets", "positions", [id, account.address])
        .then(([up, down]) => {
          if (!stale) setPosition({ up, down });
        })
        .catch(() => {});
    return () => {
      stale = true;
    };
  }, [rt, id, account.address, data]);
  return id ? (data.positions[id] ?? position) : undefined;
}
