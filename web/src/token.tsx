import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import {
  parseAbi,
  encodeAbiParameters,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { ArrowDown, ArrowLeftRight, Info } from "lucide-react";
import { useApp } from "./state";
import { ZERO, protocolAbis } from "./config";
import { amount, fmt, friendly } from "./domain";
const quoteAbi = protocolAbis.quoter;
const permitAbi = protocolAbis.permit;
export function TokenPage() {
  const { rt, data, send, setWalletOpen, tx } = useApp();
  const account = useAccount();
  const token = rt.contract("LaunchToken").address;
  const pair = rt.deployment.network.pairToken;
  const [buy, setBuy] = useState(true);
  const [value, setValue] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<{
    input: bigint;
    out: bigint;
    minimum: bigint;
    at: number;
    signature: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allowance, setAllowance] = useState(0n);
  const [permitted, setPermitted] = useState(0n);
  const [expiration, setExpiration] = useState(0);
  const [balance, setBalance] = useState<bigint>();
  const walletReadSequence = useRef(0);
  const input = buy ? pair.address : token,
    output = buy ? token : pair.address;
  const inSymbol = buy ? pair.symbol : "pIMD",
    outSymbol = buy ? "pIMD" : pair.symbol;
  const inDecimals = buy ? pair.decimals : 18,
    outDecimals = buy ? 18 : pair.decimals;
  const u = rt.deployment.network.uniswapV4;
  const signature = `${input}:${value}:${slippage}:${account.address ?? ""}`;
  useEffect(() => {
    setQuote(undefined);
    setError("");
  }, [signature]);
  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(
      () =>
        setQuote((current) => (current?.at === quote.at ? undefined : current)),
      Math.max(0, 45000 - (Date.now() - quote.at)),
    );
    return () => clearTimeout(timer);
  }, [quote]);
  useEffect(() => {
    setAllowance(0n);
    setPermitted(0n);
    setExpiration(0);
    setBalance(undefined);
  }, [account.address, input]);
  useEffect(() => {
    if (tx?.phase === "confirmed") setQuote(undefined);
  }, [tx?.phase, tx?.hash]);
  const refreshWallet = useCallback(async () => {
    if (!account.address) return;
    const sequence = ++walletReadSequence.current;
    const [a, [p, e], b] = await Promise.all([
      rt.client.readContract({
        address: input,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, u.permit2 as Address],
      }),
      rt.client.readContract({
        address: u.permit2 as Address,
        abi: permitAbi,
        functionName: "allowance",
        args: [account.address, input, u.universalRouter as Address],
      }),
      rt.client.readContract({
        address: input,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);
    if (sequence === walletReadSequence.current) {
      setAllowance(a);
      setPermitted(p);
      setExpiration(Number(e));
      setBalance(b);
    }
  }, [account.address, input, rt, u]);
  useEffect(() => {
    void refreshWallet().catch((e) => setError(friendly(e)));
    return () => {
      walletReadSequence.current++;
    };
  }, [refreshWallet, data]);
  async function getQuote() {
    setBusy(true);
    setError("");
    setQuote(undefined);
    try {
      const inputAmount = amount(value, inDecimals);
      if (inputAmount >= 2n ** 128n)
        throw new Error("This swap exceeds the uint128 input limit.");
      const slip = Number(slippage);
      if (!Number.isFinite(slip) || slip <= 0 || slip > 5)
        throw new Error("Choose slippage greater than 0 and at most 5%.");
      if (!data.verified)
        throw new Error("Contract verification is required before quoting.");
      await refreshWallet();
      const [poolCode, routerCode, quoterCode, permitCode] = await Promise.all(
        ["poolManager", "universalRouter", "quoter", "permit2"].map((k) =>
          rt.client.getCode({ address: u[k] as Address }),
        ),
      );
      if (
        [poolCode, routerCode, quoterCode, permitCode].some(
          (c) => !c || c === "0x",
        )
      )
        throw new Error(
          "A required Uniswap contract is unavailable at the configured RPC.",
        );
      const result = await rt.client.simulateContract({
        address: u.quoter as Address,
        abi: quoteAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: rt.deployment.poolKey,
            zeroForOne:
              input.toLowerCase() ===
              rt.deployment.poolKey.currency0.toLowerCase(),
            exactAmount: inputAmount,
            hookData: "0x",
          },
        ],
      });
      const out = result.result[0];
      if (out <= 0n)
        throw new Error(
          "The pool returned no output. Liquidity may be unavailable.",
        );
      const bps = BigInt(Math.floor(slip * 100));
      if (out >= 2n ** 128n)
        throw new Error(
          "The quoted output exceeds the router limit. Reduce the input amount.",
        );
      if ((out * (10000n - bps)) / 10000n === 0n)
        throw new Error(
          "Increase the amount: the minimum received rounds to zero.",
        );
      setQuote({
        input: inputAmount,
        out,
        minimum: (out * (10000n - bps)) / 10000n,
        at: Date.now(),
        signature,
      });
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  const valid =
    quote && quote.signature === signature && Date.now() - quote.at < 45000;
  const needsApproval = valid && allowance < quote.input;
  const needsPermit =
    valid &&
    (permitted < quote.input ||
      expiration < Math.floor(Date.now() / 1000) + 1200);
  function next() {
    setError("");
    try {
      if (!account.address) {
        setWalletOpen(true);
        return;
      }
      if (!valid)
        throw new Error(
          "Refresh the quote before continuing. Quotes expire after 45 seconds.",
        );
      if ((balance ?? 0n) < quote.input)
        throw new Error(`Your wallet does not have enough ${inSymbol}.`);
      if (needsApproval) {
        send(
          `ERC20:${input}`,
          "approve",
          [u.permit2, quote.input],
          `Approve ${inSymbol} to Permit2`,
          `Allow Permit2 to spend exactly ${fmt(quote.input, inDecimals)} ${inSymbol}. Router permission and the swap are separate transactions.`,
        );
        return;
      }
      if (needsPermit) {
        send(
          `PERMIT2:${u.permit2}`,
          "approve",
          [
            input,
            u.universalRouter,
            quote.input,
            Math.floor(Date.now() / 1000) + 3600,
          ],
          "Permit router spending",
          `Allow the configured Universal Router to spend ${fmt(quote.input, inDecimals)} ${inSymbol} through Permit2 for 1 hour.`,
        );
        return;
      }
      const keyType = {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      } as const;
      const extended = u.extendedSwapParams === true;
      const components = [
        { ...keyType, name: "poolKey" },
        { name: "zeroForOne", type: "bool" },
        { name: "amountIn", type: "uint128" },
        { name: "amountOutMinimum", type: "uint128" },
        ...(extended ? [{ name: "extra", type: "uint256" }] : []),
        { name: "hookData", type: "bytes" },
      ];
      const p0 = encodeAbiParameters([{ type: "tuple", components }] as any, [
        [
          rt.deployment.poolKey,
          input.toLowerCase() === rt.deployment.poolKey.currency0.toLowerCase(),
          quote.input,
          quote.minimum,
          ...(extended ? [0n] : []),
          "0x",
        ],
      ]);
      const p1 = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [input, quote.input],
      );
      const p2 = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [output, quote.minimum],
      );
      const encoded = encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        ["0x060c0f", [p0, p1, p2]],
      );
      send(
        `ROUTER:${u.universalRouter}`,
        "execute",
        ["0x10", [encoded], BigInt(Math.floor(Date.now() / 1000) + 1200)],
        `Swap ${inSymbol} for ${outSymbol}`,
        `Spend ${fmt(quote.input, inDecimals)} ${inSymbol} for at least ${fmt(quote.minimum, outDecimals)} ${outSymbol}. Slippage ${slippage}%. The exact attested pool key is used. Simulation runs before your wallet prompt.`,
        input === ZERO ? quote.input : 0n,
      );
    } catch (e) {
      setError(friendly(e));
    }
  }
  return (
    <div className="page-content token-page">
      <div className="page-heading">
        <div>
          <h1>A stake in what’s next.</h1>
          <p className="muted">
            Trade pIMD through its attested Uniswap v4 pool.
          </p>
        </div>
      </div>
      <div className="token-layout">
        <section className="panel swap-panel">
          <div className="section-heading">
            <h2>Swap pIMD</h2>
            <ArrowLeftRight size={20} />
          </div>
          <label htmlFor="swap-input">You pay ({inSymbol})</label>
          <div className="amount-input">
            <input
              id="swap-input"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
            />
            <span aria-hidden="true">{inSymbol}</span>
          </div>
          <div className="section-heading">
            <span className="caption muted">
              Wallet: {fmt(balance, inDecimals)} {inSymbol}
            </span>
            <button
              className="icon-button"
              aria-label="Reverse swap direction"
              onClick={() => setBuy((b) => !b)}
            >
              <ArrowDown size={18} />
            </button>
          </div>
          <div className="swap-output">
            <span className="muted">You receive ({outSymbol})</span>
            <strong>{valid ? fmt(quote.out, outDecimals, 8) : "–"}</strong>
          </div>
          <label>
            Slippage tolerance (%)
            <input
              inputMode="decimal"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
            />
          </label>
          <dl className="data-list">
            <div>
              <dt>Minimum received</dt>
              <dd>
                {valid
                  ? `${fmt(quote.minimum, outDecimals, 8)} ${outSymbol}`
                  : "–"}
              </dd>
            </div>
            <div>
              <dt>Pool fee</dt>
              <dd>1.25%</dd>
            </div>
            <div>
              <dt>Quote validity</dt>
              <dd>45 seconds</dd>
            </div>
          </dl>
          <button
            className="wide"
            onClick={() => void getQuote()}
            disabled={busy || !data.verified}
          >
            {busy ? "Simulating quote…" : "Get quote"}
          </button>
          <button
            className="primary wide"
            onClick={next}
            disabled={
              account.isConnected &&
              (!valid ||
                balance === undefined ||
                account.chainId !== rt.chain.id)
            }
          >
            {!account.address
              ? "Connect wallet"
              : balance === undefined
                ? "Loading wallet balance…"
                : needsApproval
                  ? `1. Approve ${inSymbol}`
                  : needsPermit
                    ? "2. Permit router"
                    : "3. Review swap"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="caption muted">
            Approvals are explicit transactions. Refresh the quote after each
            confirmation. No real swap is submitted during site validation.
          </p>
        </section>
        <section className="token-story">
          <img src="./logo.svg" width="64" height="64" alt="pIMD mark" />
          <h2>p is for probability.</h2>
          <p>
            pIMD is the token for the prediction market community. Holders vote
            for future listings and modifications. The app does not add a
            governance mechanism to the deployed contracts.
          </p>
          <h3>Launch allocation</h3>
          <div
            className="allocation-bar"
            aria-label="50% burned, 35% pool, 10% swarm, 5% developer"
          >
            <i />
            <i />
            <i />
            <i />
          </div>
          <dl className="allocation-list">
            <div>
              <dt>Burned</dt>
              <dd>50%</dd>
            </div>
            <div>
              <dt>Liquidity pool</dt>
              <dd>35%</dd>
            </div>
            <div>
              <dt>Swarm</dt>
              <dd>10%</dd>
            </div>
            <div>
              <dt>Developer / owner</dt>
              <dd>5%</dd>
            </div>
          </dl>
          <p className="caption muted">
            These are the approved launch economics. Distribution is performed
            by the launch factory, outside the token. The token has a fixed 1
            billion supply, 18 decimals, and no mint, pause, upgrade or transfer
            fee.
          </p>
          <p className="caption muted">
            <Info size={14} />
            Prediction shares are backed by USDC and the listed asset,
            independently of pIMD.
          </p>
        </section>
      </div>
    </div>
  );
}
