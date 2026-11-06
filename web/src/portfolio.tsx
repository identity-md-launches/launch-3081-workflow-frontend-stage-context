import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  History,
  RefreshCw,
} from "lucide-react";
import { useApp } from "./state";
import { useIndex } from "./indexer";
import { USDC } from "./config";
import { amount, fmt, short, friendly, date, type Market } from "./domain";
import { useProof, proofArgument } from "./proof";
export function Portfolio() {
  const { rt, data, setWalletOpen, marketLimit, loadMarkets } = useApp();
  const account = useAccount();
  const index = useIndex();
  const [tab, setTab] = useState("Positions");
  const markets = data.markets.filter((m) => {
    const p = data.positions[m.id];
    return p && (p.up > 0n || p.down > 0n);
  });
  const claimable = markets.filter(
    (m) => m.outcome !== 0 || Number(m.end) + 259200 < data.timestamp,
  );
  const totalUSDC = data.balances[USDC]?.free ?? 0n;
  const orders = index.logs.filter(
    (l) =>
      l.eventName === "OrderPlaced" &&
      l.args.trader?.toLowerCase() === account.address?.toLowerCase(),
  );
  const ownOrders = new Set(orders.map((log) => String(log.args.order)));
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Your portfolio</h1>
          <p className="muted">Balances, positions and every onchain move.</p>
        </div>
        {account.address && (
          <span className="address-chip">
            <Wallet size={16} />
            {short(account.address)}
          </span>
        )}
      </div>
      {!account.isConnected && (
        <div className="notice">
          <Wallet size={20} />
          <div>
            <strong>Bring your wallet. See your positions.</strong>
            <p className="caption muted">
              Connect to load your balances and shares.
            </p>
          </div>
          <button className="primary" onClick={() => setWalletOpen(true)}>
            Connect wallet
          </button>
        </div>
      )}
      <div className="stat-grid">
        <div>
          <span className="muted">Free USDC</span>
          <strong>{account.address ? `${fmt(totalUSDC)} USDC` : "–"}</strong>
        </div>
        <div>
          <span className="muted">Loaded positions</span>
          <strong>{account.address ? markets.length : "–"}</strong>
        </div>
        <div>
          <span className="muted">Ready to claim</span>
          <strong>{account.address ? claimable.length : "–"}</strong>
        </div>
      </div>
      <div className="portfolio-grid">
        <section className="panel">
          <h2>Manage balance</h2>
          <Funding />
        </section>
        <section className="positions-panel panel">
          <div className="section-heading">
            <div className="underline-tabs">
              {["Positions", "Open orders", "History"].map((t) => (
                <button
                  className={tab === t ? "active" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === "Positions" ? (
            <>
              <div className="section-heading">
                <span className="caption muted">
                  {markets.length} positions in{" "}
                  {Math.min(data.marketTotal, marketLimit)} loaded markets
                </span>
                <ClaimAll markets={claimable} />
              </div>
              {markets.length ? (
                markets.map((m) => <PositionRow key={m.id} market={m} />)
              ) : (
                <div className="empty">
                  <Wallet size={28} />
                  <h3>No positions loaded</h3>
                  <p>Buy an outcome or split collateral to open a position.</p>
                  <a className="button" href="#markets">
                    Explore markets
                  </a>
                </div>
              )}
              {data.marketTotal > marketLimit && (
                <button onClick={loadMarkets}>Load 100 more markets</button>
              )}
            </>
          ) : tab === "Open orders" ? (
            <>
              <HistoryStatus />
              {index.complete &&
                orders.map((l) => (
                  <OpenOrder key={String(l.args.order)} id={l.args.order} />
                ))}
              {!orders.length && index.complete && (
                <div className="empty">
                  <strong>No orders found</strong>
                  <p>Place a limit order in a market to appear here.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <HistoryStatus />
              {index.logs
                .filter((l) => {
                  const a = l.args;
                  return (
                    [a.account, a.trader].some(
                      (v) =>
                        v?.toLowerCase() === account.address?.toLowerCase(),
                    ) ||
                    [a.order, a.maker, a.taker].some(
                      (id) => id !== undefined && ownOrders.has(String(id)),
                    )
                  );
                })
                .slice(-100)
                .reverse()
                .map((l) => (
                  <div
                    className="history-row"
                    key={`${l.transactionHash}:${l.logIndex}`}
                  >
                    <History size={16} />
                    <div>
                      <strong>{l.eventName}</strong>
                      <span className="caption muted">
                        Block {String(l.blockNumber)}
                        {l.args.amount !== undefined
                          ? ` · ${fmt(l.args.amount, l.args.token?.toLowerCase() === USDC ? 6 : 18)} ${l.args.token?.toLowerCase() === USDC ? "USDC" : "asset units"}`
                          : ""}
                      </span>
                    </div>
                    <a
                      href={`${rt.deployment.network.explorer}/tx/${l.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View ${l.eventName} transaction`}
                    >
                      <ExternalLink size={16} />
                    </a>
                  </div>
                ))}
            </>
          )}
        </section>
      </div>
      <p className="caption muted">
        Free balances exclude collateral and order escrow. Values update every
        30 seconds and after confirmations. History uses 12 confirmations; the
        latest actions may not appear yet.
      </p>
    </div>
  );
}
export function Funding() {
  const { rt, data, send, setWalletOpen } = useApp();
  const account = useAccount();
  const [token, setToken] = useState(USDC);
  const [mode, setMode] = useState("Deposit");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const a = data.assets.find(
    (a) => a.token.toLowerCase() === token.toLowerCase(),
  );
  const symbol = token === USDC ? "USDC" : (a?.symbol ?? "Asset");
  const decimals = token === USDC ? 6 : (a?.decimals ?? 18);
  const b = data.balances[token.toLowerCase()];
  let n = 0n;
  try {
    if (value) n = amount(value, decimals);
  } catch {
    /* validate on click */
  }
  const needsApproval =
    mode === "Deposit" && n > 0n && (b?.allowance ?? 0n) < n;
  function act() {
    setError("");
    try {
      if (!account.address) {
        setWalletOpen(true);
        return;
      }
      const n = amount(value, decimals);
      if (mode === "Deposit" && (b?.wallet ?? 0n) < n)
        throw new Error(`Your wallet does not have enough ${symbol}.`);
      if (mode === "Withdraw" && (b?.free ?? 0n) < n)
        throw new Error(
          `Your free ${symbol} balance is too low. Cancel orders or claim positions to release funds.`,
        );
      if (needsApproval)
        send(
          `ERC20:${token}`,
          "approve",
          [rt.contract("PimdMarkets").address, n],
          `Approve ${symbol}`,
          `Allow PimdMarkets to spend exactly ${fmt(n, decimals, decimals)} ${symbol}. Deposit is a separate transaction.`,
        );
      else
        send(
          "PimdMarkets",
          mode === "Deposit" ? "deposit" : "withdraw",
          [token, n],
          `${mode} ${symbol}`,
          `${mode} ${fmt(n, decimals, decimals)} ${symbol} ${mode === "Deposit" ? "from your wallet to your free market balance" : "from your free market balance to your wallet"}.`,
        );
    } catch (e) {
      setError(friendly(e));
    }
  }
  return (
    <div className="funding">
      <div className="segmented">
        <button
          aria-pressed={mode === "Deposit"}
          onClick={() => setMode("Deposit")}
        >
          <ArrowDownToLine size={15} />
          Deposit
        </button>
        <button
          aria-pressed={mode === "Withdraw"}
          onClick={() => setMode("Withdraw")}
        >
          <ArrowUpFromLine size={15} />
          Withdraw
        </button>
      </div>
      <label>
        Token
        <select
          value={token}
          onChange={(e) => {
            setToken(e.target.value as typeof USDC);
            setValue("");
            setError("");
          }}
        >
          <option value={USDC}>USDC</option>
          {data.assets.map((a) => (
            <option key={a.token} value={a.token}>
              {a.symbol}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount ({symbol})
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          aria-describedby="funding-error"
        />
      </label>
      <dl className="data-list">
        <div>
          <dt>Wallet</dt>
          <dd>
            {fmt(b?.wallet, decimals)} {symbol}
          </dd>
        </div>
        <div>
          <dt>Free balance</dt>
          <dd>
            {fmt(b?.free, decimals)} {symbol}
          </dd>
        </div>
      </dl>
      <button
        className="primary wide"
        disabled={
          account.isConnected &&
          (!data.verified || !b || account.chainId !== rt.chain.id)
        }
        onClick={act}
      >
        {!account.address
          ? "Connect wallet"
          : !b
            ? "Loading balances…"
            : needsApproval
              ? `1. Approve ${symbol}`
              : mode === "Deposit"
                ? `Deposit ${symbol}`
                : `Withdraw ${symbol}`}
      </button>
      <p className="caption muted">
        {needsApproval
          ? "After approval confirms, deposit the same amount in a second transaction."
          : "Only free funds can be withdrawn. Every transaction is simulated before signing."}
      </p>
      {error && (
        <p className="error" role="alert" id="funding-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function HistoryStatus() {
  const index = useIndex();
  return (
    <div className="history-status">
      <p className="caption muted" role="status">
        {index.progress}
      </p>
      <div className="button-row">
        <button disabled={index.busy} onClick={() => void index.load()}>
          <RefreshCw size={14} />
          {index.busy
            ? "Loading events…"
            : index.complete
              ? "Refresh history"
              : "Load / continue history"}
        </button>
        {index.logs.length > 0 && (
          <button disabled={index.busy} onClick={index.clear}>
            Reset history
          </button>
        )}
      </div>
      {index.error && (
        <p className="error" role="alert">
          {index.error}
        </p>
      )}
    </div>
  );
}
function PositionRow({ market: m }: { market: Market }) {
  const { data, send, rt } = useApp();
  const account = useAccount();
  const p = data.positions[m.id];
  const a = data.assets.find((a) => a.token === m.token);
  const startProof = useProof(m.version, m.start),
    endProof = useProof(m.version, m.end);
  const proofs = [startProof, endProof]
    .filter(Boolean)
    .map((p) => proofArgument(p!));
  const ended = Number(m.end) < data.timestamp;
  return (
    <div className="position-row">
      <div>
        <strong>
          {a?.symbol ?? short(m.token)}{" "}
          {m.ladderStrike ? `above $${fmt(m.ladderStrike, 18)}` : "Up or Down"}
        </strong>
        <span className="caption muted">
          {date(m.start)} UTC ·{" "}
          {["Active", "Up wins", "Down wins", "Refund"][m.outcome]}
        </span>
        <span className="caption">
          <span className="up-text">{fmt(p.up, 6, 6)} Up</span> ·{" "}
          <span className="down-text">{fmt(p.down, 6, 6)} Down</span>
        </span>
      </div>
      <button
        disabled={!ended || !data.verified || account.chainId !== rt.chain.id}
        onClick={() =>
          send(
            "PimdMarkets",
            proofs.length ? "claimWithProofs" : "claim",
            proofs.length ? [m.id, p.up, p.down, proofs] : [m.id, p.up, p.down],
            "Claim outcome shares",
            `Redeem ${fmt(p.up, 6, 6)} Up and ${fmt(p.down, 6, 6)} Down shares into free balances.${proofs.length ? " Includes verified boundary proofs." : ""} Settlement must be available or the whole transaction reverts.`,
          )
        }
      >
        Claim{proofs.length ? " with proof" : ""}
      </button>
    </div>
  );
}
function ClaimAll({ markets }: { markets: Market[] }) {
  const { send, data, rt } = useApp();
  const account = useAccount();
  return (
    <button
      disabled={
        !markets.length || !data.verified || account.chainId !== rt.chain.id
      }
      onClick={() =>
        send(
          "PimdMarkets",
          "claimAll",
          [markets.slice(0, 64).map((m) => m.id)],
          "Claim all available",
          `Claim ${Math.min(markets.length, 64)} settled or refundable markets. An ineligible market reverts the whole batch. Open orders must be cancelled separately.`,
        )
      }
    >
      Claim all{markets.length ? ` (${Math.min(markets.length, 64)})` : ""}
    </button>
  );
}
function OpenOrder({ id }: { id: bigint }) {
  const { rt, data, send } = useApp();
  const account = useAccount();
  const [o, setO] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let stale = false;
    void rt
      .read("PimdMarkets", "order", [id])
      .then((value) => {
        if (!stale) setO(value);
      })
      .catch((e) => {
        if (!stale) setError(friendly(e));
      });
    return () => {
      stale = true;
    };
  }, [rt, id, data]);
  if (error) return <p className="error">{error}</p>;
  if (!o?.resting) return null;
  const expired = Number(o.expiry) <= data.timestamp;
  return (
    <div className="position-row">
      <div>
        <strong>
          #{String(id)} ·{" "}
          {["Buy Up", "Buy Down", "Sell Up", "Sell Down"][o.action]}
        </strong>
        <span className="caption muted">
          {fmt(o.remaining, 6, 6)} shares at ${fmt(o.limitPrice)} ·{" "}
          {expired ? "Expired" : `Expires ${date(o.expiry)} UTC`}
        </span>
      </div>
      <div className="button-row">
        <button
          disabled={!data.verified || account.chainId !== rt.chain.id}
          onClick={() =>
            send(
              "PimdMarkets",
              "cancel",
              [id],
              "Cancel order",
              `Cancel order #${id} and release its unfilled escrow to free balance. No cancellation fee.`,
            )
          }
        >
          Cancel
        </button>
        {expired && (
          <button
            disabled={!data.verified || account.chainId !== rt.chain.id}
            onClick={() =>
              send(
                "PimdMarkets",
                "expire",
                [[id]],
                "Release expired order",
                `Release escrow from expired order #${id}.`,
              )
            }
          >
            Release
          </button>
        )}
      </div>
    </div>
  );
}
