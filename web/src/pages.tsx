import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import {
  Trophy,
  ArrowUpDown,
  ArrowUpRight,
  ShieldCheck,
  BookOpen,
  Settings2,
} from "lucide-react";
import { useApp } from "./state";
import { useIndex, ledger } from "./indexer";
import { HistoryStatus } from "./portfolio";
import { amount, fmt, short, friendly, type Market } from "./domain";
export function Leaderboard() {
  const { rt, data } = useApp();
  const index = useIndex();
  const [period, setPeriod] = useState("all");
  const [market, setMarket] = useState("all");
  const [sort, setSort] = useState("pnl");
  const [descending, setDescending] = useState(true);
  const [meta, setMeta] = useState<Record<string, Market>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let stale = false;
    if (!index.complete) return;
    setLoading(true);
    void (async () => {
      try {
        const result: Record<string, Market> = {};
        const ids = index.logs.filter((l) => l.eventName === "MarketCreated");
        for (let i = 0; i < ids.length; i += 10) {
          await Promise.all(
            ids.slice(i, i + 10).map(async (l) => {
              const m = await rt.read("PimdMarkets", "market", [l.args.market]);
              result[l.args.market] = {
                id: l.args.market,
                ...m,
                period: l.args.period,
              };
            }),
          );
        }
        if (!stale) setMeta(result);
      } catch (e) {
        if (!stale) setError(friendly(e));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [index.complete, index.logs, rt]);
  const ranked = useMemo(() => {
    const factors = Object.fromEntries(
      Object.entries(meta).map(([id, m]) => [id, m.factor]),
    );
    const { rows } = ledger(index.logs, factors);
    const accounts = new Map<
      string,
      { account: string; pnl: bigint; trades: number; markets: number }
    >();
    for (const r of rows) {
      const m = meta[r.market];
      if (
        !m ||
        m.outcome === 0 ||
        !m.close ||
        (period !== "all" && m.period !== Number(period)) ||
        (market !== "all" && r.market !== market)
      )
        continue;
      let cash = r.cash,
        asset = r.asset;
      const wins = m.outcome === 1 ? r.up : m.outcome === 2 ? r.down : 0n;
      if (m.outcome === 3) {
        cash += r.up;
        asset += r.down * m.factor;
      } else {
        cash += wins;
        asset += wins * m.factor;
      }
      const pnl = cash * 10n ** 12n + (asset * m.close) / (m.factor * 1000000n);
      const key = r.account.toLowerCase();
      const a = accounts.get(key) ?? {
        account: r.account,
        pnl: 0n,
        trades: 0,
        markets: 0,
      };
      a.pnl += pnl;
      a.trades += r.trades;
      a.markets++;
      accounts.set(key, a);
    }
    return [...accounts.values()].sort((a, b) => {
      const aa =
          sort === "pnl"
            ? a.pnl
            : BigInt(sort === "trades" ? a.trades : a.markets),
        bb =
          sort === "pnl"
            ? b.pnl
            : BigInt(sort === "trades" ? b.trades : b.markets);
      return (
        (aa === bb ? a.account.localeCompare(b.account) : aa > bb ? -1 : 1) *
        (descending ? 1 : -1)
      );
    });
  }, [index.logs, meta, period, market, sort, descending]);
  function sortBy(value: string) {
    if (sort === value) setDescending((d) => !d);
    else {
      setSort(value);
      setDescending(true);
    }
  }
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Who called it?</h1>
          <p className="muted">
            Settlement PnL, reconstructed from contract events.
          </p>
        </div>
        <Trophy className="page-icon" size={32} />
      </div>
      <section className="panel">
        <div className="section-heading leaderboard-filters">
          <h2>Leaderboard</h2>
          <div className="button-row">
            <select
              aria-label="Filter leaderboard by period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="all">All periods</option>
              {data.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter leaderboard by market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option value="all">All markets</option>
              {Object.entries(meta).map(([id, m]) => (
                <option key={id} value={id}>
                  {short(id)} ·{" "}
                  {new Date(Number(m.start) * 1000).toISOString().slice(0, 16)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <HistoryStatus />
        {loading && <p role="status">Loading market snapshots…</p>}
        {index.complete && !loading && ranked.length ? (
          <div className="leaderboard-table">
            <div className="leader-row table-head">
              <span>Rank / trader</span>
              <button onClick={() => sortBy("pnl")}>
                PnL (USD)
                <ArrowUpDown size={12} />
              </button>
              <button onClick={() => sortBy("trades")}>
                Trades
                <ArrowUpDown size={12} />
              </button>
              <button onClick={() => sortBy("markets")}>
                Markets
                <ArrowUpDown size={12} />
              </button>
            </div>
            {ranked.map((r, i) => (
              <div className="leader-row" key={r.account}>
                <span>
                  <span className="rank">{i + 1}</span>
                  <a
                    href={`${rt.deployment.network.explorer}/address/${r.account}`}
                    target="_blank"
                    rel="noreferrer"
                    title={r.account}
                  >
                    {short(r.account)}
                  </a>
                </span>
                <strong className={r.pnl >= 0n ? "up-text" : "down-text"}>
                  {r.pnl >= 0n ? "+" : ""}${fmt(r.pnl, 18, 2)}
                </strong>
                <span>{r.trades}</span>
                <span>{r.markets}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <Trophy size={32} />
            <h3>
              {index.complete
                ? "No resolved-market results yet"
                : "A leaderboard with receipts"}
            </h3>
            <p>
              {index.complete
                ? "Settled markets with recorded close prices will appear here."
                : "Load confirmed history to calculate rankings. No sample rankings are shown."}
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
      <section className="reading-block">
        <h3>What this PnL measures</h3>
        <p>
          For resolved markets, we sum trade, split, merge, swap and claim cash
          flows, deduct actual fees, include maker rebates, and add the
          remaining settlement entitlement. Asset cash flows are valued at that
          market’s recorded closing USD price. Deposits, withdrawals, oracle
          bonds, the owner's protocol fee income and ETH network costs are
          excluded.
        </p>
        <p>
          Open markets are excluded. Refund markets without a recorded close
          cannot be valued in USD and are excluded. Rankings stay hidden while
          history is partial; 12 confirmations and anchor checks reduce
          reorganization risk. A final settlement valuation is different from
          the exchange rate at the time of every trade.
        </p>
      </section>
    </div>
  );
}
export function Docs() {
  const { rt } = useApp();
  return (
    <div className="page-content docs-page">
      <div className="page-heading">
        <div>
          <h1>Know your market.</h1>
          <p className="muted">
            The rules, the risks and the contracts behind pIMD.
          </p>
        </div>
        <BookOpen size={32} />
      </div>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Documentation">
          <a
            href="#docs"
            onClick={() => document.getElementById("rules")?.scrollIntoView()}
          >
            Market rules
          </a>
          <a href="#token">pIMD token & allocation</a>
          <a
            href="#docs"
            onClick={() =>
              document.getElementById("contract-list")?.scrollIntoView()
            }
          >
            Deployed contracts
          </a>
        </nav>
        <article className="reading-block">
          <section id="rules">
            <h2>One pair. Two outcomes.</h2>
            <p>
              Every pair of Up and Down shares is backed by exactly 1 USDC and
              the market’s fixed asset units per share. For the initial IMD
              listing, that is 1 IMD. Shares have 6 decimals.
            </p>
            <p>
              Split deposits collateral from your free balance and mints both
              sides. Merge burns equal shares and returns collateral before
              settlement. Winning shares redeem both coins; losing shares redeem
              nothing. In a tie or void, Up redeems 1 USDC and Down redeems its
              asset units.
            </p>
            <h3>UTC boundaries</h3>
            <p>
              Hourly and daily rounds use UTC. Weeks begin Monday at 00:00.
              Monthly rounds follow the calendar, including leap years. A market
              is created by its first order or split, but its price boundaries
              remain the scheduled start and end.
            </p>
            <h3>Above-target markets</h3>
            <p>
              Ladder markets ask whether the closing price exceeds a chosen USD
              target with at most 3 significant digits. Yes is Up; No is Down.
              Equal prices use the refund rule.
            </p>
            <h3>The mirrored book</h3>
            <p>
              The book quotes the USDC price x of one Up share. Buy Up is a bid;
              Buy Down is an ask. Sell Down is a bid; Sell Up is an ask. Buying
              Down locks the asset leg and max(0, 1−x) USDC per share, or
              receives x−1 USDC when x exceeds 1.
            </p>
            <p>
              Resting orders lock collateral, shares, fees and any swap reserve.
              The minimum notional is 1 USDC, the price tick is 0.0001 USDC, and
              expiry is at least 5 minutes away and no later than market end.
              Market sweeps cancel unfilled remainders. Matching is FIFO within
              price and examines at most 64 maker orders per transaction.
            </p>
            <h3>Fees and reserves</h3>
            <p>
              V is 1 plus the latest recorded boundary asset price. q is the
              mirrored Up price divided by V, clamped to 0.01–0.99. Per-share
              taker fee is 0.07 × q × (1−q) × V; maker fee is 0.01 × q × (1−q) ×
              V. Up fees use USDC; Down fees use the asset at the boundary
              price. 25% of the taker fee goes to the maker, with the rest and
              maker fees to the owner.
            </p>
            <p>
              There are no fees on cancellation, expiry, split, merge or payout.
              Additional 0.001024 USDC reserves cover rounding where required by
              the implementation. Fee budgets are explicit, not a rate; partial
              executions can need extra rounding headroom. Unspent reserves
              return to free balance.
            </p>
            <h3>Paying Down with IMD only</h3>
            <p>
              The contract swaps IMD into exactly the missing USDC contribution
              on its fixed IMD → ETH → USDC path. The maximum swap input is in
              addition to the collateral and fee budget, with a 5% minimum
              buffer. A failing incoming-order swap reverts the entire
              transaction. A failing resting-order swap cancels that order and
              returns its unspent escrow.
            </p>
            <h3>Price resolution</h3>
            <p>
              The boundary price is a median across 3 consecutive Ethereum
              blocks, proven with RLP headers, EIP-2935 history and PoolManager
              storage proofs. The site builds and validates a witness from the
              configured public RPC; historical proof availability depends on
              that provider.
            </p>
            <p>
              After 27 hours without a proof, anyone can post a 10 IMD bonded
              proposal. A 1-hour challenge can request IdentityMD oracle
              resolution. Oracle service costs are advanced separately. Deferred
              requests can be retried; failure and timeout refund bonds, while
              already spent service fees may stay spent. Missing prices after 3
              days allow a refund outcome.
            </p>
            <h3>Understand the risk</h3>
            <p>
              The 3-block median is a spot convention, not a long TWAP. Illiquid
              pools can be manipulated. Optimistic resolution needs observers.
              USDC issuer restrictions, RPC outages, oracle dependencies and
              immutable contract defects can affect funds. The fallback’s
              separate per-pool median composition can differ from the proof’s
              median of complete paths.
            </p>
            <p>
              The existing security document is an implementation contributor’s
              review aid. This frontend assignment does not certify an
              independent audit or contract safety.
            </p>
          </section>
          <section id="contract-list">
            <h2>Attested deployment</h2>
            <p className="caption muted">
              Ethereum · Source commit{" "}
              <span className="break">{rt.deployment.sourceCommit}</span>
            </p>
            <div className="contracts-list">
              {rt.deployment.contracts.map((c) => (
                <div key={c.name}>
                  <strong>{c.name}</strong>
                  <a
                    className="address"
                    href={`${rt.deployment.network.explorer}/address/${c.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.address}
                    <ArrowUpRight size={14} />
                  </a>
                  <a className="caption" href={`./${c.abiPath}`} download>
                    Download verified ABI
                  </a>
                </div>
              ))}
            </div>
            <p className="caption muted break">
              Attestation: {rt.deployment.attestationHash}
            </p>
            <a href="./imd-deployment.json" download>
              Download deployment configuration
            </a>
          </section>
        </article>
      </div>
      <OwnerSettings />
    </div>
  );
}
function OwnerSettings() {
  const { rt, data, send } = useApp();
  const account = useAccount();
  const [duration, setDuration] = useState("");
  const [offset, setOffset] = useState("0");
  const [config, setConfig] = useState("");
  const [error, setError] = useState("");
  if (
    !account.address ||
    account.address.toLowerCase() !== data.owner.toLowerCase()
  )
    return null;
  return (
    <section className="panel owner-settings">
      <h2>
        <Settings2 size={20} />
        Owner settings
      </h2>
      <p>
        Changes apply to future markets. Existing market snapshots cannot be
        changed.
      </p>
      <div className="form-grid">
        <label>
          Period duration (seconds)
          <input
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label>
          UTC offset (seconds)
          <input
            inputMode="numeric"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </label>
      </div>
      <button
        disabled={!data.verified || account.chainId !== rt.chain.id}
        onClick={() => {
          try {
            const d = Number(duration),
              o = Number(offset);
            if (
              !Number.isInteger(d) ||
              d < 300 ||
              d > 31622400 ||
              !Number.isInteger(o) ||
              o < 0 ||
              o >= d
            )
              throw new Error(
                "Use a duration from 300 to 31,622,400 seconds and an offset below the duration.",
              );
            send(
              "PimdRegistry",
              "addPeriod",
              [d, o],
              "Add market period",
              `Add a future market period of ${d} seconds, offset ${o} seconds UTC.`,
            );
          } catch (e) {
            setError(friendly(e));
          }
        }}
      >
        Add period
      </button>
      <details>
        <summary>Add or update an asset</summary>
        <p className="caption muted">
          Supply the exact Asset tuple: token, unitsPerShare (token atomic
          units), maxOpenPairs (6-decimal shares), hops (1–3), path (3 PoolKey
          objects). Unused path entries remain zero. Routes must end in USDC;
          the IMD route is fixed. Values are verified onchain during simulation.
        </p>
        <label>
          Asset configuration JSON
          <textarea
            rows={8}
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            placeholder="Paste the complete Asset tuple"
          />
        </label>
        <button
          disabled={!data.verified || account.chainId !== rt.chain.id}
          onClick={() => {
            setError("");
            try {
              const a = JSON.parse(config);
              a.unitsPerShare = BigInt(a.unitsPerShare);
              a.maxOpenPairs = BigInt(a.maxOpenPairs);
              if (a.path?.length !== 3)
                throw new Error(
                  "The Asset tuple needs exactly three path entries.",
                );
              send(
                "PimdRegistry",
                "configureAsset",
                [a],
                "Configure future asset",
                `Create a new immutable asset version for ${a.token}. Units per share: ${a.unitsPerShare}; open-pair cap: ${a.maxOpenPairs}. Existing markets keep their prior version.`,
              );
            } catch (e) {
              setError(friendly(e));
            }
          }}
        >
          Review asset configuration
        </button>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="caption muted">
        <ShieldCheck size={14} />
        The owner receives fees but cannot pause markets or withdraw user
        collateral.
      </p>
    </section>
  );
}
