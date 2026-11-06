import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  parseAbi,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  formatUnits,
  type Hex,
} from "viem";
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  ChevronRight,
  Info,
  Clock3,
  Plus,
  Minus,
  RefreshCw,
  Layers,
  Activity,
} from "lucide-react";
import { useApp, useMarketPosition } from "./state";
import { ZERO, USDC, protocolAbis } from "./config";
import {
  amount,
  bounds,
  marketId,
  fmt,
  usd,
  date,
  feeQuote,
  escrow,
  friendly,
  ceil,
  ladderTargets,
  type Spec,
  type Asset,
  type Period,
  type Market,
} from "./domain";
import { Modal } from "./wallet";
import { Resolution } from "./resolution";
import { useProof, proofArgument } from "./proof";

const stateAbi = protocolAbis.stateView;
const poolParams = parseAbiParameters(
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
);
export function useSpot(asset: Asset | undefined) {
  const { rt } = useApp();
  const [spot, setSpot] = useState<bigint>();
  const [error, setError] = useState("");
  useEffect(() => {
    setSpot(undefined);
    let stopped = false;
    async function load() {
      if (!asset) return;
      try {
        let result = asset.unitsPerShare * 10n ** 12n;
        let token = asset.token;
        for (const p of asset.path.slice(0, asset.hops)) {
          const id = keccak256(encodeAbiParameters(poolParams, [p]));
          const [sqrt] = await rt.client.readContract({
            address: rt.deployment.network.uniswapV4.stateView as `0x${string}`,
            abi: stateAbi,
            functionName: "getSlot0",
            args: [id],
          });
          if (sqrt === 0n)
            throw new Error("The configured price pool is not initialized.");
          result =
            token.toLowerCase() === p.currency0.toLowerCase()
              ? (result * sqrt * sqrt) / 2n ** 192n
              : (result * 2n ** 192n) / (sqrt * sqrt);
          token =
            token.toLowerCase() === p.currency0.toLowerCase()
              ? p.currency1
              : p.currency0;
        }
        if (!stopped) {
          setSpot(result);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(friendly(e));
      }
    }
    void load();
    const id = setInterval(() => void load(), 20000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [rt, asset?.token, asset?.version]);
  return { spot, error };
}
export function MarketPage() {
  const { data, rt } = useApp();
  const [periodId, setPeriodId] = useState(0);
  const [assetToken, setAssetToken] = useState("");
  const [when, setWhen] = useState(0);
  const [ladder, setLadder] = useState("");
  const [ladderMode, setLadderMode] = useState(false);
  const [side, setSide] = useState<"Up" | "Down">("Up");
  const [tab, setTab] = useState("Chart");
  const [pairAction, setPairAction] = useState<"split" | "merge" | null>(null);
  const asset =
    data.assets.find((a) => a.token === assetToken) ?? data.assets[0];
  const period = data.periods.find((p) => p.id === periodId) ?? data.periods[0];
  const [snapshotAsset, setSnapshotAsset] = useState<Asset>();
  const viewAsset = snapshotAsset ?? asset;
  const { spot, error: spotError } = useSpot(viewAsset);
  const [clock, setClock] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  let start = 0n,
    end = 0n;
  if (period) {
    const [nowStart, nowEnd] = bounds(period, clock);
    if (when === 0) {
      start = nowStart;
      end = nowEnd;
    } else {
      [start, end] = bounds(
        period,
        when > 0 ? Number(nowEnd) + 1 : Number(nowStart) - 1,
      );
    }
  }
  let strike = 0n;
  try {
    if (ladderMode && ladder) strike = amount(ladder, 18);
  } catch {
    /* validation is next to the ladder control */
  }
  const spec: Spec = {
    token: asset?.token ?? ZERO,
    period: period?.id ?? 0,
    start,
    strike,
  };
  const id = marketId(spec);
  const [market, setMarket] = useState<Market>();
  const [startPrice, setStartPrice] = useState(0n);
  const [endPrice, setEndPrice] = useState(0n);
  const [selectedLatest, setSelectedLatest] = useState<{
    boundary: bigint;
    price: bigint;
  }>();
  const [book, setBook] = useState<{ bids: any[]; asks: any[]; error: string }>(
    { bids: [], asks: [], error: "" },
  );
  const [bookLimit, setBookLimit] = useState(20);
  useEffect(() => {
    setSnapshotAsset(undefined);
    setMarket(undefined);
    setStartPrice(0n);
    setEndPrice(0n);
    setSelectedLatest(undefined);
    setBook({ bids: [], asks: [], error: "" });
  }, [id]);
  useEffect(() => {
    let stale = false;
    if (!asset || !data.verified) return;
    async function load() {
      try {
        const m = await rt.read("PimdMarkets", "market", [id]);
        const version = m.version || asset!.version;
        const latestBoundary = await rt.read(
          "BoundaryOracle",
          "latestBoundary",
          [version],
        );
        const latestPrice = await rt.read("BoundaryOracle", "price", [
          version,
          latestBoundary,
        ]);
        if (!stale)
          setSelectedLatest({ boundary: latestBoundary, price: latestPrice });
        if (m.version && m.version !== asset!.version) {
          const pinned = await rt.read("PimdRegistry", "asset", [m.version]);
          if (!stale)
            setSnapshotAsset({ ...asset!, ...pinned, version: m.version });
        }
        const [sp, ep, bid, ask] = await Promise.all([
          rt.read("BoundaryOracle", "price", [version, start]),
          rt.read("BoundaryOracle", "price", [version, end]),
          rt.read("PimdMarkets", "bestBid", [id]),
          rt.read("PimdMarkets", "bestAsk", [id]),
        ]);
        async function follow(head: bigint) {
          const rows = [];
          let next = head;
          while (next !== 0n && rows.length < bookLimit) {
            const order = await rt.read("PimdMarkets", "order", [next]);
            rows.push({ id: next, ...order });
            next = order.next;
          }
          return rows;
        }
        const [bids, asks] = await Promise.all([follow(bid), follow(ask)]);
        if (!stale) {
          setMarket(
            m.token !== ZERO ? { id, ...m, period: spec.period } : undefined,
          );
          setStartPrice(sp);
          setEndPrice(ep);
          setBook({ bids, asks, error: "" });
        }
      } catch (e) {
        if (!stale) setBook((b) => ({ ...b, error: friendly(e) }));
      }
    }
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [id, asset, rt, data.head, bookLimit]);
  const remaining = Math.max(0, Number(end) - clock);
  const ended = end !== 0n && clock >= Number(end);
  const countdown = ended
    ? "Ended"
    : when > 0
      ? `Starts in ${Math.max(0, Math.ceil((Number(start) - clock) / 60))}m`
      : `${String(Math.floor(remaining / 3600)).padStart(2, "0")}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const latest =
    data.prices[market?.version ?? asset?.version ?? 0] ?? selectedLatest;
  const target = strike || startPrice;
  return (
    <div className="market-layout">
      <aside className="sidebar">
        <div className="sidebar-title">
          <Layers size={16} />
          Timeframes
        </div>
        <div className="periods">
          {(data.periods.length
            ? data.periods
            : [
                { id: 0, label: "Hourly" },
                { id: 1, label: "Daily" },
                { id: 2, label: "Weekly" },
                { id: 3, label: "Monthly" },
              ]
          ).map((p) => (
            <button
              key={p.id}
              className={p.id === periodId ? "selected" : ""}
              onClick={() => {
                setPeriodId(p.id);
                setWhen(0);
              }}
            >
              <Clock3 size={16} />
              {p.label}
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        <div className="sidebar-title assets-title">Assets</div>
        <div className="asset-list">
          {data.assets.map((a) => (
            <button
              className={a.token === asset?.token ? "selected" : ""}
              key={a.token}
              onClick={() => setAssetToken(a.token)}
            >
              <span className="asset-avatar small">{a.symbol.slice(0, 1)}</span>
              {a.symbol}
              <span className="live-dot" />
            </button>
          ))}
          {["pIMD", "YOLO", "FWA", "INFER", "IMDSTR", "HIVE", "OG"]
            .filter((s) => !data.assets.some((a) => a.symbol === s))
            .map((s) => (
              <div className="soon-row" key={s}>
                <span className="asset-avatar small faded">
                  {s.slice(0, 1)}
                </span>
                <span>{s}</span>
                <span className="soon">Soon</span>
              </div>
            ))}
        </div>
        <p className="caption muted vote-note">
          pIMD holders vote for the next listings and modifications.
        </p>
        <a className="sidebar-doc" href="#docs">
          <Info size={16} />
          How markets work
          <ArrowUpRight size={15} />
        </a>
      </aside>
      <div className="market-content">
        <div className="intro">
          <div>
            <h1>Take a position.</h1>
            <p>Bet UP or DOWN on IMD. Fully onchain.</p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <svg viewBox="0 0 190 90">
              <path
                d="M0 70h190M0 40h190M0 10h190M25 0v90M80 0v90M135 0v90"
                stroke="currentColor"
                opacity=".15"
              />
              <path
                d="M5 70l32-22 20 10 27-38 24 16 21-26 23 16 28-22"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <circle cx="180" cy="4" r="4" fill="currentColor" />
            </svg>
          </div>
        </div>
        <div className="mobile-filters">
          <label className="sr-only" htmlFor="mobile-period">
            Timeframe
          </label>
          <select
            id="mobile-period"
            value={periodId}
            onChange={(e) => setPeriodId(Number(e.target.value))}
          >
            {(data.periods.length
              ? data.periods
              : [
                  { id: 0, label: "Hourly" },
                  { id: 1, label: "Daily" },
                  { id: 2, label: "Weekly" },
                  { id: 3, label: "Monthly" },
                ]
            ).map((p) => (
              <option value={p.id} key={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="mobile-asset">
            Asset
          </label>
          <select
            id="mobile-asset"
            value={asset?.token ?? ""}
            onChange={(e) => setAssetToken(e.target.value)}
          >
            {data.assets.length ? (
              data.assets.map((a) => (
                <option key={a.token} value={a.token}>
                  {a.symbol}
                </option>
              ))
            ) : (
              <option value="">IMD</option>
            )}
          </select>
        </div>
        <div className="workspace">
          <section className="market-title">
            <div className="asset-avatar">
              {asset?.symbol.slice(0, 1) ?? "I"}
            </div>
            <div>
              <h2>
                {asset?.symbol ?? "IMD"}{" "}
                {ladderMode ? "above target" : "Up or Down"}
              </h2>
              <p className="muted caption">
                {start
                  ? `${date(start)} – ${date(end)} UTC`
                  : "Loading onchain schedule…"}
              </p>
            </div>
            <span className="market-status">
              <span className="live-dot" />
              {ended ? "Ended" : when > 0 ? "Upcoming" : "Open"}
            </span>
          </section>
          <div className="market-summary">
            <div>
              <span className="muted caption">
                {when > 0 && !strike
                  ? "Estimated price to beat"
                  : "Price to beat"}
              </span>
              <strong>{usd(target || (when > 0 ? spot : undefined))}</strong>
            </div>
            <div>
              <span className="muted caption">
                Current price <span className="live-dot" />
              </span>
              <strong>{usd(spot)}</strong>
            </div>
            <div className="countdown">
              <span className="muted caption">
                <Clock3 size={13} /> {ended ? "Round closed" : "Time remaining"}
              </span>
              <strong>{countdown}</strong>
            </div>
          </div>
          <TradePanel
            key={id}
            asset={viewAsset}
            {...{ spec, id, market, side, setSide, latest, spot, ended }}
            ready={data.verified && !!asset && (!ladderMode || strike > 0n)}
            onDeposit={() => (location.hash = "portfolio")}
            onResolution={() => {
              if (when > 0) setWhen(0);
              setTab("Resolution");
              requestAnimationFrame(() =>
                document
                  .querySelector(".chart-section")
                  ?.scrollIntoView({ block: "start", behavior: "instant" }),
              );
            }}
          />
          <section className="chart-section">
            <div className="chart-toolbar">
              <div className="underline-tabs">
                {["Chart", "Order book", "Rules", "Resolution"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="segmented compact">
                {["Past", "Now", "Next"].map((label, i) => (
                  <button
                    key={label}
                    aria-pressed={when === i - 1}
                    onClick={() => setWhen(i - 1)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {tab === "Chart" ? (
              <BoundaryChart
                asset={viewAsset}
                target={target}
                spot={spot}
                error={spotError}
              />
            ) : tab === "Order book" ? (
              <OrderBook
                book={book}
                side={side}
                symbol={asset?.symbol ?? "IMD"}
                latest={latest?.price ?? 0n}
                assetUnits={
                  viewAsset
                    ? Number(
                        formatUnits(
                          viewAsset.unitsPerShare,
                          viewAsset.decimals,
                        ),
                      )
                    : 1
                }
                onMore={() => setBookLimit((n) => n + 20)}
              />
            ) : tab === "Rules" ? (
              <MarketRules symbol={asset?.symbol ?? "IMD"} />
            ) : (
              <Resolution
                spec={spec}
                asset={viewAsset}
                market={market}
                startPrice={startPrice}
                endPrice={endPrice}
              />
            )}
            <div className="market-bottom">
              <span>
                <Activity size={14} />{" "}
                {market
                  ? `${fmt(market.pairs)} backed pairs`
                  : "First order creates this market"}
              </span>
              <a
                href={`${rt.deployment.network.explorer}/address/${rt.contract("PimdMarkets").address}`}
                target="_blank"
                rel="noreferrer"
              >
                View contract <ArrowUpRight size={14} />
              </a>
            </div>
          </section>
          <section className="market-tools">
            <div className="tools-header">
              <div className="segmented">
                <button
                  aria-pressed={!ladderMode}
                  onClick={() => setLadderMode(false)}
                >
                  Up / Down
                </button>
                <button
                  aria-pressed={ladderMode}
                  onClick={() => setLadderMode(true)}
                >
                  Above target
                </button>
              </div>
              <div className="button-row">
                <button
                  disabled={!data.verified || ended}
                  onClick={() => setPairAction("split")}
                >
                  <Plus size={15} />
                  Split
                </button>
                <button
                  disabled={!market || ended || !data.verified}
                  onClick={() => setPairAction("merge")}
                >
                  <Minus size={15} />
                  Merge
                </button>
              </div>
            </div>
            {ladderMode && (
              <div className="ladder-controls">
                <label>
                  Target price in USD
                  <input
                    inputMode="decimal"
                    placeholder="1.50"
                    value={ladder}
                    onChange={(e) => setLadder(e.target.value)}
                  />
                </label>
                <p className="caption muted">
                  Up is Yes, Down is No. Targets use at most 3 significant
                  digits.
                </p>
                <div className="ladder-cards">
                  {(period?.calendarMonth
                    ? ["1", "1.5", "2", "2.5", "3", "4", "5", "7"]
                    : spot
                      ? ladderTargets(spot)
                      : []
                  ).map((v) => (
                    <LadderCard
                      key={v}
                      target={v}
                      asset={asset}
                      spec={spec}
                      selected={ladder === String(v)}
                      select={() => {
                        setLadder(String(v));
                        window.scrollTo({ top: 0, behavior: "instant" });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <MarketMaintenance market={market} ended={ended} />
          </section>
        </div>
        <section className="more-markets">
          <div className="section-heading">
            <h2>Find your timeframe</h2>
            <span className="caption muted">Same asset. A different view.</span>
          </div>
          <div className="market-cards">
            {data.periods.map((p) => (
              <MarketCard
                key={p.id}
                period={p}
                asset={asset}
                selected={p.id === periodId}
                select={() => {
                  setPeriodId(p.id);
                  setWhen(0);
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
              />
            ))}
          </div>
        </section>
        <div className="market-disclaimer">
          <Info size={16} />
          <p>
            Each pair is backed by 1 USDC +{" "}
            {asset ? fmt(asset.unitsPerShare, asset.decimals) : "1"}{" "}
            {asset?.symbol ?? "IMD"}. Prices and returns can change. Trade only
            what you can afford to lose.
          </p>
        </div>
      </div>
      {pairAction && asset && (
        <PairDialog
          action={pairAction}
          close={() => setPairAction(null)}
          spec={spec}
          id={id}
          asset={viewAsset ?? asset}
        />
      )}
    </div>
  );
}

function TradePanel({
  spec,
  id,
  asset,
  market,
  side,
  setSide,
  latest,
  spot,
  ended,
  ready,
  onDeposit,
  onResolution,
}: {
  spec: Spec;
  id: Hex;
  asset?: Asset;
  market?: Market;
  side: "Up" | "Down";
  setSide: (s: "Up" | "Down") => void;
  latest?: { price: bigint; boundary: bigint };
  spot?: bigint;
  ended: boolean;
  ready: boolean;
  onDeposit: () => void;
  onResolution: () => void;
}) {
  const { data, rt, send, setWalletOpen } = useApp();
  const account = useAccount();
  const [mode, setMode] = useState("Buy");
  const [kind, setKind] = useState("Market");
  const [units, setUnits] = useState("$");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiry, setExpiry] = useState("60");
  const [assetOnly, setAssetOnly] = useState(false);
  const [maxSwap, setMaxSwap] = useState("");
  const [feeReserve, setFeeReserve] = useState("");
  const [hint, setHint] = useState("0");
  const [steps, setSteps] = useState("32");
  const [error, setError] = useState("");
  const [feeInfo, setFeeInfo] = useState(false);
  const witness = useProof(market?.version ?? asset?.version ?? 0, spec.start);
  const held = useMarketPosition(id);
  latest =
    witness && (!latest?.price || witness.boundary > latest.boundary)
      ? { price: witness.price, boundary: witness.boundary }
      : latest;
  const action =
    mode === "Buy" ? (side === "Up" ? 0 : 1) : side === "Up" ? 2 : 3;
  const down = side === "Down";
  const decimals = asset?.decimals ?? 18;
  const factor =
    market?.factor ?? (asset ? asset.unitsPerShare / 1000000n : 10n ** 12n);
  const symbol = asset?.symbol ?? "IMD";
  const v = 10n ** 18n + (latest?.price ?? 0n);
  let q = 0n,
    x = 0n,
    fee = 0n,
    max = 0n,
    required = { usdc: 0n, asset: 0n },
    estimateError = "";
  try {
    if (quantity) q = amount(quantity);
    if (price) {
      if (units === "%") {
        const pct = amount(price, 4);
        if (pct >= 1000000n) throw new Error("Probability must be below 100%.");
        x = ((down ? 1000000n - pct : pct) * v) / 10n ** 18n;
        x = (x / 100n) * 100n;
      } else if (units === "Coin" && down) {
        const sideCost = amount(price, decimals);
        const val =
          v -
          (sideCost * (latest?.price ?? 0n)) /
            (asset?.unitsPerShare ?? 10n ** 18n);
        if (val <= 0n)
          throw new Error(
            "The coin price implies a nonpositive mirrored UP price.",
          );
        x = val / 10n ** 12n;
        x = (x / 100n) * 100n;
      } else x = amount(price);
    }
    if (q && x && latest?.price) {
      fee = feeQuote(x, q, latest.price, factor, true, down);
      if (feeReserve) fee = amount(feeReserve, down ? decimals : 6);
    }
    if (assetOnly && maxSwap) max = amount(maxSwap, decimals);
    required = escrow(action, q, x, factor, fee, assetOnly, max);
  } catch (e) {
    estimateError = friendly(e);
  }
  const freeUSDC = data.balances[USDC]?.free;
  const freeAsset = asset
    ? data.balances[asset.token.toLowerCase()]?.free
    : undefined;
  const creditAtLimit =
    action === 1 && x > 1000000n ? ceil(q * x, 1000000n) - q : 0n;
  const totalAtSpot =
    Number(required.usdc) / 1e6 +
    (spot
      ? ((Number(required.asset) / Number(asset?.unitsPerShare ?? 10n ** 18n)) *
          Number(spot)) /
        1e18
      : 0) -
    Number(creditAtLimit) / 1e6;
  const payout = q
    ? mode === "Buy"
      ? (Number(q) / 1e6) * (1 + Number(spot ?? 0n) / 1e18)
      : down
        ? Number(q - ceil(q * x, 1000000n)) / 1e6 +
          ((Number(q * factor) / Number(asset?.unitsPerShare ?? 10n ** 18n)) *
            Number(spot ?? 0n)) /
            1e18
        : Number(ceil(q * x, 1000000n)) / 1e6
    : 0;
  const displayPrice = !price
    ? "Set price"
    : units === "$"
      ? `$${fmt(x)}`
      : units === "%"
        ? `${latest?.price ? ((down ? 1 - (Number(x) * 1e12) / Number(v) : (Number(x) * 1e12) / Number(v)) * 100).toFixed(1) : "–"}%`
        : `${down && latest?.price ? (((Number(v) / 1e18 - Number(x) / 1e6) / (Number(latest.price) / 1e18)) * (Number(asset?.unitsPerShare ?? 10n ** 18n) / 10 ** decimals)).toFixed(5) : fmt(x)} ${down ? symbol : "USDC"}`;
  function review() {
    setError("");
    try {
      if (!account.address) {
        setWalletOpen(true);
        return;
      }
      if (!asset || !ready)
        throw new Error(
          "Wait for the deployment and asset checks to complete.",
        );
      if (spec.strike) {
        let k = spec.strike;
        while (k % 10n === 0n) k /= 10n;
        if (k > 999n || spec.strike > 10n ** 30n)
          throw new Error(
            "Use a target with at most 3 significant digits and at most 1 trillion USD.",
          );
      }
      if (estimateError) throw new Error(estimateError);
      q = amount(quantity);
      if (x <= 0n || x % 100n !== 0n)
        throw new Error(
          "Use a positive mirrored UP price in ticks of 0.0001 USDC.",
        );
      if ((q * x) / 1000000n < 1000000n)
        throw new Error(
          "The order needs at least $1 of mirrored UP notional. Increase the shares.",
        );
      if (q >= 2n ** 128n || x >= 2n ** 128n)
        throw new Error("This amount exceeds the contract’s order limit.");
      if (!latest?.price)
        throw new Error(
          "Record a boundary price in Resolution before placing an order.",
        );
      const now = Math.floor(Date.now() / 1000);
      const expiryAt = BigInt(
        Math.min(
          Number(
            market?.end ??
              bounds(
                data.periods.find((p) => p.id === spec.period)!,
                Number(spec.start),
              )[1],
          ),
          now + Number(expiry) * 60,
        ),
      );
      if (kind === "Limit" && expiryAt < BigInt(now + 300))
        throw new Error(
          "A resting order must expire at least 5 minutes from now and before the market ends.",
        );
      if (
        Number(steps) < 1 ||
        Number(steps) > 64 ||
        !Number.isInteger(Number(steps))
      )
        throw new Error("Choose 1 to 64 matching steps.");
      if (!/^\d+$/.test(hint) || BigInt(hint) >= 2n ** 64n)
        throw new Error("Use a valid unsigned order ID as the insertion hint.");
      if (assetOnly && down && mode === "Buy" && x < 1000000n) {
        const need = q - ceil(q * x, 1000000n);
        const min = ceil(
          ceil(need * factor * 10n ** 18n, latest.price) * 10500n,
          10000n,
        );
        if (max < min)
          throw new Error(
            `Set a maximum swap input of at least ${fmt(min, decimals, 8)} ${symbol}, including the 5% buffer.`,
          );
      }
      if (
        (freeUSDC ?? 0n) < required.usdc ||
        (freeAsset ?? 0n) < required.asset
      )
        throw new Error(
          "Deposit enough USDC and asset tokens into your free balance before placing this order.",
        );
      if (mode === "Sell" && (down ? (held?.down ?? 0n) : (held?.up ?? 0n)) < q)
        throw new Error(
          `You do not hold enough ${side} shares. Reduce the quantity.`,
        );
      const input = {
        action,
        quantity: q,
        limitPrice: x,
        expiry: expiryAt,
        immediateOrCancel: kind === "Market",
        assetOnly: action === 1 && assetOnly,
        maxSwapInput: max,
        feeBudget: fee,
        insertionHint: BigInt(hint),
        maxSteps: Number(steps),
      };
      send(
        "PimdMarkets",
        witness ? "placeWithProofs" : "place",
        witness ? [spec, input, [proofArgument(witness)]] : [spec, input],
        `${mode} ${side}`,
        `${mode} ${fmt(q, 6, 6)} ${side} shares. Mirrored UP limit: ${fmt(x)} USDC. Reserve ${fmt(required.usdc)} USDC + ${fmt(required.asset, decimals)} ${symbol}, including fee budget. ${kind === "Market" ? "Unfilled shares are cancelled." : "Unfilled shares rest until expiry."}${witness ? " Includes a verified start-boundary proof." : ""}`,
      );
    } catch (e) {
      setError(friendly(e));
    }
  }
  return (
    <section className="trade-panel">
      <div className="trade-top">
        <div className="underline-tabs">
          <button
            className={mode === "Buy" ? "active" : ""}
            onClick={() => {
              setMode("Buy");
              setError("");
            }}
          >
            Buy
          </button>
          <button
            className={mode === "Sell" ? "active" : ""}
            onClick={() => {
              setMode("Sell");
              setAssetOnly(false);
              setError("");
            }}
          >
            Sell
          </button>
        </div>
        <select
          aria-label="Order type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option>Market</option>
          <option>Limit</option>
        </select>
      </div>
      <div className="side-buttons">
        <button
          className={side === "Up" ? "up selected" : "up"}
          aria-pressed={side === "Up"}
          onClick={() => {
            setSide("Up");
            setAssetOnly(false);
          }}
        >
          <ArrowUpRight size={20} />
          {spec.strike ? "Yes" : "Up"}
          <span>{side === "Up" ? displayPrice : ""}</span>
        </button>
        <button
          className={side === "Down" ? "down selected" : "down"}
          aria-pressed={side === "Down"}
          onClick={() => setSide("Down")}
        >
          <ArrowDownRight size={20} />
          {spec.strike ? "No" : "Down"}
          <span>{side === "Down" ? displayPrice : ""}</span>
        </button>
      </div>
      <div className="price-label">
        <label htmlFor="order-price">
          {kind === "Market" ? "Worst price" : "Limit price"}
          {units === "$" ? " · mirrored UP" : ""}
        </label>
        <div className="segmented tiny">
          {["Coin", "$", "%"].map((u) => (
            <button
              key={u}
              aria-pressed={units === u}
              onClick={() => {
                let converted = "";
                if (x > 0n) {
                  if (u === "%" && latest?.price) {
                    const probability =
                      (down
                        ? 1 - (Number(x) * 1e12) / Number(v)
                        : (Number(x) * 1e12) / Number(v)) * 100;
                    if (probability > 0 && probability < 100)
                      converted = probability.toFixed(4);
                  } else if (u === "Coin" && down && latest?.price) {
                    const cost =
                      ((v - x * 10n ** 12n) *
                        (asset?.unitsPerShare ?? 10n ** 18n)) /
                      latest.price;
                    if (cost > 0n) converted = formatUnits(cost, decimals);
                  } else if (u !== "%" && !(u === "Coin" && down))
                    converted = formatUnits(x, 6);
                }
                setUnits(u);
                setPrice(converted);
              }}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <input
        id="order-price"
        name="limit-price"
        inputMode="decimal"
        placeholder={units === "%" ? "e.g. 50" : "Enter a price bound"}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        aria-describedby="trade-price-hint"
      />
      <p className="caption muted price-hint" id="trade-price-hint">
        {kind === "Market"
          ? "Immediate or cancel. Price bounds every fill."
          : "Price/time priority. Tick: 0.0001 USDC."}
      </p>
      <label className="quantity-label" htmlFor="order-quantity">
        Shares<span className="caption muted">6 decimals</span>
      </label>
      <div className="amount-input">
        <input
          id="order-quantity"
          name="shares"
          inputMode="decimal"
          placeholder="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <span>shares</span>
      </div>
      {kind === "Limit" && (
        <label className="expiry">
          Expires in
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
            <option value="100000">At market end</option>
          </select>
        </label>
      )}
      {down && mode === "Buy" && (
        <div className="down-funding">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={assetOnly}
              onChange={(e) => setAssetOnly(e.target.checked)}
            />
            Pay with {symbol} only
          </label>
          <p className="caption muted">
            {assetOnly
              ? `The contract swaps ${symbol} for the USDC leg; at least 5% buffer required.`
              : `Collateral uses ${symbol} + USDC from your free balance.`}
          </p>
          {assetOnly && (
            <label>
              Maximum swap input ({symbol})
              <input
                inputMode="decimal"
                value={maxSwap}
                onChange={(e) => setMaxSwap(e.target.value)}
                placeholder="Set your spending cap"
              />
            </label>
          )}
        </div>
      )}
      <div className="trade-estimates">
        {creditAtLimit > 0n && (
          <div>
            <span className="muted">USDC credit on full fill</span>
            <strong>≥ {fmt(creditAtLimit, 6, 6)} USDC</strong>
          </div>
        )}
        {action === 1 && assetOnly && (
          <div>
            <span className="muted">Maximum swap cost</span>
            <strong>
              {max ? `${fmt(max, decimals)} ${symbol}` : "Set a cap"}
            </strong>
          </div>
        )}
        <div>
          <span className="muted">Total reserved</span>
          <strong>{q ? `${fmt(required.usdc)} USDC` : "–"}</strong>
        </div>
        {down && q > 0n && (
          <div>
            <span className="muted">Asset reserve</span>
            <strong>
              {fmt(required.asset, decimals)} {symbol}
            </strong>
          </div>
        )}
        <div>
          <button className="fee-help" onClick={() => setFeeInfo(true)}>
            Fee reserve <Info size={13} />
          </button>
          <span>
            {q && latest?.price
              ? `${fmt(fee, down ? decimals : 6, 6)} ${down ? symbol : "USDC"}`
              : "–"}
          </span>
        </div>
        <div>
          <span className="muted">To win</span>
          <strong>
            {q && mode === "Buy"
              ? `${fmt(q, 6, 6)} USDC + ${fmt(q * factor, decimals)} ${symbol}`
              : "–"}
          </strong>
        </div>
      </div>
      <div className="payout">
        <span className="caption muted">
          {mode === "Sell"
            ? "Estimated sale proceeds in USD"
            : "Estimated payout in USD"}
        </span>
        <strong className={payout < 0 ? "down-text" : undefined}>
          {q && spot
            ? `$${payout.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
            : "–"}
          {payout < 0 ? (
            <ArrowDownRight size={20} />
          ) : (
            <ArrowUpRight size={20} />
          )}
        </strong>
        <span
          className={
            q && spot && latest?.price && mode === "Buy"
              ? `profit-value ${payout - totalAtSpot < 0 ? "down-text" : "up-text"}`
              : "caption muted"
          }
        >
          {q && spot && latest?.price && mode === "Buy"
            ? `Potential profit ≈ $${(payout - totalAtSpot).toFixed(2)}`
            : mode === "Sell"
              ? "Gross proceeds; fees are reserved separately."
              : "USD estimate uses the live asset spot price."}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {estimateError && quantity && (
        <p className="caption error">{estimateError}</p>
      )}
      <button
        className={`primary wide ${down ? "red-primary" : ""}`}
        onClick={review}
        disabled={
          account.isConnected &&
          (!ready ||
            !latest?.price ||
            freeUSDC === undefined ||
            freeAsset === undefined ||
            (mode === "Sell" && !held) ||
            account.chainId !== rt.chain.id ||
            ended)
        }
      >
        {!account.isConnected
          ? "Connect to trade"
          : ended
            ? "Market ended"
            : !latest?.price
              ? "Boundary price needed"
              : freeUSDC === undefined ||
                  freeAsset === undefined ||
                  (mode === "Sell" && !held)
                ? "Loading balances…"
                : `${mode} ${spec.strike ? (down ? "No" : "Yes") : side}`}
      </button>
      {account.isConnected && !latest?.price && (
        <p className="caption price-prerequisite">
          A recorded price or verified proof is required for fees.{" "}
          <button className="fee-help" onClick={onResolution}>
            Build a current-boundary proof
          </button>
        </p>
      )}
      <div className="trade-balance">
        <span>Free: {fmt(freeUSDC)} USDC</span>
        <button onClick={onDeposit}>
          Deposit <Plus size={13} />
        </button>
      </div>
      <details className="advanced">
        <summary>Advanced order settings</summary>
        <label>
          Fee reserve ({down ? symbol : "USDC"})
          <input
            inputMode="decimal"
            value={feeReserve}
            onChange={(e) => setFeeReserve(e.target.value)}
            placeholder="Auto: taker estimate"
          />
        </label>
        <label>
          Maximum matching steps
          <input
            inputMode="numeric"
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
          />
        </label>
        <label>
          Preceding order ID
          <input
            inputMode="numeric"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </label>
        <p className="caption muted">
          Unspent reserves return to free balance. At most 64 maker orders are
          examined per call. Partial fills can require a larger fee reserve.
        </p>
      </details>
      {feeInfo && (
        <Modal title="How fees work" close={() => setFeeInfo(false)}>
          <p>
            Taker: 0.07 × q × (1−q) × V per share. Maker: 0.01 × q × (1−q) × V.
            V = 1 USDC + asset price at the latest recorded boundary; q is the
            mirrored UP price / V, clamped to 1–99%.
          </p>
          <p>
            25% of the taker fee goes to the maker. The remainder and maker fee
            go to the owner. Down fees are paid in {symbol}; Up fees in USDC.
          </p>
          <p>
            No fees on cancel, expiry, split, merge or payout. Swap cost is the
            asset spent to buy the USDC leg, bounded by your maximum. ETH
            network fees are separate.
          </p>
          <p className="caption muted">
            Fee reference:{" "}
            {latest?.boundary
              ? `${date(latest.boundary)} UTC`
              : "No boundary recorded"}
            . A stale boundary can change the relationship to live USD prices.
          </p>
        </Modal>
      )}
    </section>
  );
}

function LadderCard({
  target,
  asset,
  spec,
  selected,
  select,
}: {
  target: string;
  asset?: Asset;
  spec: Spec;
  selected: boolean;
  select: () => void;
}) {
  const { rt, data } = useApp();
  const id = marketId({ ...spec, strike: amount(String(target), 18) });
  const [odds, setOdds] = useState<{
    yes?: string;
    no?: string;
    error?: string;
  }>({});
  useEffect(() => {
    let stale = false;
    if (!asset || !data.verified) return;
    void (async () => {
      try {
        const m = await rt.read("PimdMarkets", "market", [id]);
        const version = m.version || asset.version;
        const boundary = await rt.read("BoundaryOracle", "latestBoundary", [
          version,
        ]);
        const [p, bid, ask] = await Promise.all([
          rt.read("BoundaryOracle", "price", [version, boundary]),
          rt.read("PimdMarkets", "bestBid", [id]),
          rt.read("PimdMarkets", "bestAsk", [id]),
        ]);
        const [b, a] = await Promise.all([
          bid ? rt.read("PimdMarkets", "order", [bid]) : undefined,
          ask ? rt.read("PimdMarkets", "order", [ask]) : undefined,
        ]);
        const v = 1 + Number(p) / 1e18;
        if (!stale)
          setOdds({
            yes:
              a?.resting &&
              a.remaining > 0n &&
              Number(a.expiry) > data.timestamp &&
              p
                ? `${((Number(a.limitPrice) / 1e6 / v) * 100).toFixed(1)}%`
                : undefined,
            no:
              b?.resting &&
              b.remaining > 0n &&
              Number(b.expiry) > data.timestamp &&
              p
                ? `${((1 - Number(b.limitPrice) / 1e6 / v) * 100).toFixed(1)}%`
                : undefined,
          });
      } catch {
        if (!stale) setOdds({ error: "Quotes unavailable" });
      }
    })();
    return () => {
      stale = true;
    };
  }, [rt, id, asset?.version, data.head, data.verified]);
  return (
    <button
      className={`ladder-card ${selected ? "current" : ""}`}
      onClick={select}
    >
      <strong>Above ${target}?</strong>
      <span>
        <span className="up-text">Yes {odds.yes ?? "· No quote"}</span>
        <span className="down-text">No {odds.no ?? "· No quote"}</span>
      </span>
      {odds.error && <span className="caption muted">{odds.error}</span>}
    </button>
  );
}

function MarketCard({
  period,
  asset,
  selected,
  select,
}: {
  period: Period;
  asset?: Asset;
  selected: boolean;
  select: () => void;
}) {
  const { data } = useApp();
  const [start, end] = bounds(period, data.timestamp);
  const m = data.markets.find(
    (m) =>
      m.token === asset?.token &&
      m.start === start &&
      m.end === end &&
      m.ladderStrike === 0n,
  );
  return (
    <button
      className={`market-card ${selected ? "current" : ""}`}
      onClick={select}
    >
      <span className="card-top">
        <span className="asset-avatar small">
          {asset?.symbol.slice(0, 1) ?? "I"}
        </span>
        <span>{period.label}</span>
        <ArrowUpRight size={16} />
      </span>
      <strong>{asset?.symbol ?? "IMD"} Up or Down</strong>
      <span className="caption muted">Ends {date(end)} UTC</span>
      <span className="card-outcomes">
        <span className="up-text">↗ Up</span>
        <span className="down-text">↘ Down</span>
      </span>
      <span className="caption muted">
        {m ? `${fmt(m.pairs)} backed pairs` : "No pairs minted yet"}
      </span>
    </button>
  );
}

function BoundaryChart({
  asset,
  target,
  spot,
  error,
}: {
  asset?: Asset;
  target: bigint;
  spot?: bigint;
  error: string;
}) {
  const { rt, data } = useApp();
  const [points, setPoints] = useState<{ time: number; price: number }[]>([]);
  const [chartError, setChartError] = useState("");
  useEffect(() => {
    let stale = false;
    if (!asset || !data.head) return;
    void rt.client
      .getContractEvents({
        ...rt.contract("BoundaryOracle"),
        eventName: "PriceRecorded",
        fromBlock: data.head > 10000n ? data.head - 10000n : 0n,
        toBlock: data.head,
        strict: true,
      })
      .then((logs) => {
        if (!stale)
          setPoints(
            logs
              .filter((l: any) => l.args.version === asset.version)
              .map((l: any) => ({
                time: Number(l.args.boundary),
                price: Number(l.args.price) / 1e18,
              }))
              .sort((a, b) => a.time - b.time),
          );
      })
      .catch(() => {
        if (!stale)
          setChartError(
            "Historical boundary events could not be loaded. Live spot is shown separately.",
          );
      });
    return () => {
      stale = true;
    };
  }, [rt, asset, data.head]);
  const values = [
    ...points.map((p) => p.price),
    ...(target ? [Number(target) / 1e18] : []),
    ...(spot ? [Number(spot) / 1e18] : []),
  ];
  const lo = values.length ? Math.min(...values) * 0.98 : 0,
    hi = values.length ? Math.max(...values) * 1.02 : 1;
  const y = (v: number) => 220 - ((v - lo) / (hi - lo || 1)) * 170;
  const line = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${30 + (i / Math.max(1, points.length - 1)) * 570},${y(p.price)}`,
    )
    .join(" ");
  return (
    <div className="chart">
      <svg
        viewBox="0 0 660 260"
        role="img"
        aria-label="Recorded boundary prices with market target"
      >
        <g className="chart-grid">
          {[45, 100, 155, 210].map((v) => (
            <line key={v} x1="0" x2="660" y1={v} y2={v} />
          ))}
        </g>
        {points.length > 0 && <path d={line} className="chart-line" />}
        {target > 0n && (
          <>
            <line
              x1="0"
              x2="660"
              y1={y(Number(target) / 1e18)}
              y2={y(Number(target) / 1e18)}
              className="target-line"
            />
            <text x="10" y={y(Number(target) / 1e18) - 8}>
              Target {usd(target)}
            </text>
          </>
        )}
      </svg>
      {points.length === 0 && (
        <div className="chart-empty">
          <Activity size={27} />
          <strong>No recorded price history yet</strong>
          <span className="caption muted">
            Boundary prices appear after proof submission.
          </span>
        </div>
      )}
      <div className="chart-caption">
        <span>Recorded boundaries · {asset?.symbol ?? "IMD"} / USD</span>
        <span>Live spot {usd(spot)}</span>
      </div>
      {(error || chartError) && (
        <p className="caption muted">{error || chartError}</p>
      )}
    </div>
  );
}
function OrderBook({
  book,
  side,
  symbol,
  latest,
  assetUnits,
  onMore,
}: {
  book: { bids: any[]; asks: any[]; error: string };
  side: string;
  symbol: string;
  latest: bigint;
  assetUnits: number;
  onMore: () => void;
}) {
  const [unit, setUnit] = useState("$");
  const rows =
    side === "Up"
      ? [...book.asks].reverse().concat(book.bids)
      : [...book.bids].reverse().concat(book.asks);
  return (
    <div className="orderbook">
      <div className="section-heading">
        <h3>{side} order book</h3>
        <div className="segmented tiny">
          {["Coin", "$", "%"].map((u) => (
            <button
              key={u}
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="book-head">
        <span>Side</span>
        <span>
          Price {unit === "Coin" ? (side === "Up" ? "USDC" : symbol) : unit}
        </span>
        <span>Shares</span>
      </div>
      {rows.length ? (
        rows.map((o) => {
          const p = Number(o.limitPrice) / 1e6;
          const v = 1 + Number(latest) / 1e18;
          const upBid = o.action === 0 || o.action === 3;
          const isBid = side === "Up" ? upBid : !upBid;
          return (
            <div className="book-row" key={String(o.id)}>
              <span className={isBid ? "up-text" : "down-text"}>
                {isBid ? "Bid" : "Ask"}
              </span>
              <span>
                {unit === "%"
                  ? latest
                    ? `${((side === "Up" ? p / v : 1 - p / v) * 100).toFixed(2)}%`
                    : "–"
                  : unit === "Coin" && side === "Down"
                    ? latest
                      ? (
                          ((v - p) / (Number(latest) / 1e18)) *
                          assetUnits
                        ).toFixed(5)
                      : "–"
                    : side === "Down"
                      ? latest
                        ? (v - p).toFixed(4)
                        : "–"
                      : p.toFixed(4)}
              </span>
              <span>{fmt(o.remaining)}</span>
            </div>
          );
        })
      ) : (
        <div className="empty compact-empty">
          <ArrowLeftRight size={24} />
          <strong>No resting orders</strong>
          <span>Place a limit order to start this book.</span>
        </div>
      )}
      {book.error && <p className="error">{book.error}</p>}
      {rows.length >= 20 && <button onClick={onMore}>Load more orders</button>}
      <p className="caption muted">
        One mirrored book, displayed for {side}. Coin and USD equivalents use
        the latest recorded boundary. Expired orders may remain until released.
      </p>
    </div>
  );
}
function MarketRules({ symbol }: { symbol: string }) {
  return (
    <div className="rules">
      <h3>How this market resolves</h3>
      <p>
        Up wins when the closing boundary price exceeds the starting price (or
        ladder target). Down wins when it is lower.
      </p>
      <p>
        A winning share redeems 1 USDC + the market’s {symbol} units per share.
        Equal prices or a void return 1 USDC per Up share and the asset
        collateral per Down share. Losing shares redeem nothing.
      </p>
      <p>
        Three consecutive Ethereum blocks and a median price establish each
        boundary. If proof is unavailable after 27 hours, a bonded proposal can
        be challenged for 1 hour. Missing prices after 3 days allow a refund
        outcome.
      </p>
      <p>
        Trading closes at the UTC round end. Settlement, expiry and claims
        require a transaction. Open-order shares must be released before
        claiming.
      </p>
    </div>
  );
}
function PairDialog({
  action,
  close,
  spec,
  id,
  asset,
}: {
  action: "split" | "merge";
  close: () => void;
  spec: Spec;
  id: Hex;
  asset: Asset;
}) {
  const { send } = useApp();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title={
        action === "split"
          ? "Split collateral into shares"
          : "Merge outcome shares"
      }
      close={close}
    >
      <p>
        {action === "split"
          ? `Deposit 1 USDC + ${fmt(asset.unitsPerShare, asset.decimals)} ${asset.symbol} per pair from free balance to receive 1 Up + 1 Down share.`
          : "Burn equal Up and Down shares before settlement to release both collateral tokens to free balance."}
      </p>
      <label>
        Pairs
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="decimal"
          placeholder="1.00"
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        onClick={() => {
          try {
            const n = amount(q);
            if (n >= 2n ** 128n)
              throw new Error("Quantity exceeds the uint128 share limit.");
            close();
            send(
              "PimdMarkets",
              action,
              [action === "split" ? spec : id, n],
              action === "split" ? "Split pairs" : "Merge pairs",
              `${action === "split" ? "Mint" : "Burn"} ${fmt(n, 6, 6)} Up + Down pairs. ${action === "split" ? "Lock" : "Release"} ${fmt(n, 6, 6)} USDC + ${fmt(n * (asset.unitsPerShare / 1000000n), asset.decimals)} ${asset.symbol}.`,
            );
          } catch (e) {
            setError(friendly(e));
          }
        }}
      >
        Review {action}
      </button>
    </Modal>
  );
}
function MarketMaintenance({
  market,
  ended,
}: {
  market?: Market;
  ended: boolean;
}) {
  const { send, data, rt } = useApp();
  const account = useAccount();
  const p = useMarketPosition(market?.id);
  return (
    <div className="maintenance">
      <div>
        <span className="caption muted">
          {market
            ? ["Active", "Up wins", "Down wins", "Refund"][market.outcome]
            : "Market opens with its first order"}
        </span>
        {market && (
          <span className="caption muted">
            {" "}
            · {fmt(market.reserveUSDC)} USDC backing
          </span>
        )}
      </div>
      {market && (
        <div className="button-row">
          {!ended ? (
            <button
              disabled={!data.verified || account.chainId !== rt.chain.id}
              onClick={() =>
                send(
                  "PimdMarkets",
                  "matchMarket",
                  [market.id, 32],
                  "Continue matching",
                  "Examine up to 32 maker orders in price and time priority. No keeper reward is paid.",
                )
              }
            >
              <RefreshCw size={14} />
              Match orders
            </button>
          ) : (
            <>
              <button
                disabled={
                  !data.verified ||
                  market.outcome !== 0 ||
                  account.chainId !== rt.chain.id
                }
                onClick={() =>
                  send(
                    "PimdMarkets",
                    "settle",
                    [market.id],
                    "Settle market",
                    "Record the onchain outcome using boundary prices, or refund if a required price is absent after 3 days.",
                  )
                }
              >
                Settle
              </button>
              <button
                disabled={
                  !p ||
                  (p.up === 0n && p.down === 0n) ||
                  !data.verified ||
                  account.chainId !== rt.chain.id
                }
                onClick={() =>
                  send(
                    "PimdMarkets",
                    "claim",
                    [market.id, p?.up ?? 0n, p?.down ?? 0n],
                    "Claim shares",
                    "Redeem all your available shares in this market into free contract balances. Withdraw separately to your wallet.",
                  )
                }
              >
                Claim
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
