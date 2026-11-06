import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
export type Spec = {
  token: Address;
  period: number;
  start: bigint;
  strike: bigint;
};
export type Asset = {
  token: Address;
  unitsPerShare: bigint;
  maxOpenPairs: bigint;
  hops: number;
  path: any[];
  version: number;
  symbol: string;
  decimals: number;
};
export type Period = {
  id: number;
  secondsPerRound: number;
  offset: number;
  calendarMonth: boolean;
  label: string;
};
export type Market = {
  id: Hex;
  token: Address;
  version: number;
  start: bigint;
  end: bigint;
  factor: bigint;
  maxPairs: bigint;
  ladderStrike: bigint;
  strike: bigint;
  close: bigint;
  pairs: bigint;
  reserveUSDC: bigint;
  reserveAsset: bigint;
  outcome: number;
  period?: number;
};
export const marketId = (s: Spec) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("address,uint32,uint64,uint256"), [
      s.token,
      s.period,
      s.start,
      s.strike,
    ]),
  );
export const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;
export function amount(v: string, decimals = 6) {
  if (
    !/^(?:\d+\.?\d*|\.\d+)$/.test(v) ||
    (v.split(".")[1]?.length ?? 0) > decimals
  )
    throw new Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const n = parseUnits(v, decimals);
  if (n <= 0n) throw new Error("Enter an amount greater than zero.");
  return n;
}
export const fmt = (n: bigint | undefined, decimals = 6, digits = 4) =>
  n === undefined
    ? "–"
    : Number(formatUnits(n, decimals)).toLocaleString("en-US", {
        maximumFractionDigits: digits,
      });
export const usd = (n: bigint | undefined) =>
  n === undefined || n === 0n
    ? "–"
    : `$${Number(formatUnits(n, 18)) >= 1e6 ? Number(formatUnits(n, 18)).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }) : fmt(n, 18, 5)}`;
export const date = (n: bigint | number) =>
  new Date(Number(n) * 1000).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
export function bounds(p: Period, now: number): [bigint, bigint] {
  if (p.calendarMonth) {
    const d = new Date(now * 1000);
    return [
      BigInt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000),
      BigInt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000),
    ];
  }
  const start =
    Math.floor((now - p.offset) / p.secondsPerRound) * p.secondsPerRound +
    p.offset;
  return [BigInt(start), BigInt(start + p.secondsPerRound)];
}
export const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function ladderTargets(price: bigint): string[] {
  return [
    ...new Set(
      [80n, 90n, 100n, 110n, 120n].map((percent) => {
        let value = (price * percent) / 100n;
        if (value < 1n) value = 1n;
        if (value > 10n ** 30n) value = 10n ** 30n;
        const scale = 10n ** BigInt(Math.max(0, value.toString().length - 3));
        return formatUnits((value / scale) * scale, 18);
      }),
    ),
  ];
}
export function feeQuote(
  x: bigint,
  quantity: bigint,
  price: bigint,
  factor: bigint,
  taker: boolean,
  down: boolean,
) {
  if (price <= 0n)
    throw new Error("Record a boundary price before quoting fees.");
  const v = 10n ** 18n + price;
  let q = (x * 10n ** 30n) / v;
  q = q < 10n ** 16n ? 10n ** 16n : q > 99n * 10n ** 16n ? 99n * 10n ** 16n : q;
  const curve = (q * (10n ** 18n - q)) / 10n ** 18n;
  const perShare = (((curve * v) / 10n ** 18n) * (taker ? 7n : 1n)) / 100n;
  return down
    ? ceil(quantity * perShare * factor, price)
    : ceil(quantity * perShare, 10n ** 18n);
}
export function escrow(
  action: number,
  q: bigint,
  x: bigint,
  factor: bigint,
  fee: bigint,
  assetOnly: boolean,
  maxSwap: bigint,
) {
  const cash = ceil(q * x, 1000000n);
  const down = action === 1 || action === 3;
  let usdc = 0n,
    asset = 0n;
  if (action === 0) usdc = cash + 1024n;
  if (action === 1) {
    asset = q * factor;
    if (assetOnly && cash < q) asset += maxSwap;
    else usdc = (q > cash ? q - cash : 0n) + (x < 1000000n ? 1024n : 0n);
  }
  if (action === 3 && x > 1000000n) usdc = cash - q + 1024n;
  return { usdc: usdc + (down ? 0n : fee), asset: asset + (down ? fee : 0n) };
}
export function friendly(error: any): string {
  const text = [
    error?.shortMessage,
    error?.details,
    error?.message,
    error?.cause?.shortMessage,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  if (/reject|denied|4001/i.test(text))
    return "Request declined in your wallet. Nothing was submitted. You can try again.";
  if (/InsufficientBalance/.test(text))
    return "Your free contract balance or shares are too low. Deposit funds or reduce the quantity.";
  if (/MissingPrice/.test(text))
    return "A boundary price is missing. Open Resolution to record a proof or inspect the fallback.";
  if (/InvalidOrder/.test(text))
    return "The order failed its onchain checks. Check the price tick, minimum $1 notional, expiry and fee reserve.";
  if (/InvalidMarket/.test(text))
    return "This market cannot accept that action. Check its time, settlement and boundary price availability.";
  if (/InsertionHintRequired/.test(text))
    return "The book is deep. Enter a preceding order ID under Advanced order settings.";
  if (/Unauthorized/.test(text))
    return "Only the contract owner or order maker can perform this action.";
  if (/InvalidState|InvalidAnswer|InvalidHeaders|InvalidProof/.test(text))
    return "The proof or resolution is not valid in the current onchain state. Refresh and check the boundary.";
  if (/insufficient funds/i.test(text))
    return "Your wallet needs more ETH for network fees.";
  return (
    error?.shortMessage ||
    error?.message ||
    "Unable to complete the request. Check the connection and try again."
  ).slice(0, 320);
}
