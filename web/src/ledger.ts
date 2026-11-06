import type { Address } from "viem";
export type LedgerRow = {
  account: Address;
  market: string;
  cash: bigint;
  asset: bigint;
  up: bigint;
  down: bigint;
  trades: number;
  feesCash: bigint;
  feesAsset: bigint;
};
export function ledger(logs: any[], factors: Record<string, bigint>) {
  const orders: Record<string, any> = {};
  const rows = new Map<string, LedgerRow>();
  let pendingRebates: { order: bigint; amount: bigint; asset: boolean }[] = [];
  function row(account: Address, market: string) {
    const key = `${account.toLowerCase()}:${market}`;
    if (!rows.has(key))
      rows.set(key, {
        account,
        market,
        cash: 0n,
        asset: 0n,
        up: 0n,
        down: 0n,
        trades: 0,
        feesCash: 0n,
        feesAsset: 0n,
      });
    return rows.get(key)!;
  }
  for (const l of logs) {
    const a = l.args;
    if (l.eventName === "OrderPlaced")
      orders[String(a.order)] = {
        account: a.trader,
        market: a.market,
        action: a.action,
      };
    if (l.eventName === "Split" || l.eventName === "Merged") {
      const r = row(a.account, a.market);
      const sign = l.eventName === "Split" ? 1n : -1n;
      const q = a.quantity as bigint;
      r.cash -= sign * q;
      r.asset -= sign * q * (factors[a.market] ?? 0n);
      r.up += sign * q;
      r.down += sign * q;
    }
    if (l.eventName === "Trade") {
      for (const rebate of pendingRebates) {
        if (rebate.order === a.taker) {
          const maker = orders[String(a.maker)];
          if (maker) {
            const r = row(maker.account, maker.market);
            if (rebate.asset) r.asset += rebate.amount;
            else r.cash += rebate.amount;
          }
        }
      }
      pendingRebates = [];
      const q = a.quantity as bigint,
        cost = (q * a.price + 999999n) / 1000000n;
      for (const id of [a.maker, a.taker]) {
        const o = orders[String(id)];
        if (!o) continue;
        const r = row(o.account, o.market),
          f = factors[o.market] ?? 0n;
        r.trades++;
        if (o.action === 0) {
          r.cash -= cost;
          r.up += q;
        }
        if (o.action === 1) {
          r.cash += cost - q;
          r.asset -= q * f;
          r.down += q;
        }
        if (o.action === 2) {
          r.cash += cost;
          r.up -= q;
        }
        if (o.action === 3) {
          r.cash += q - cost;
          r.asset += q * f;
          r.down -= q;
        }
      }
    }
    if (l.eventName === "ShortFunded") {
      const o = orders[String(a.order)];
      if (o) {
        const r = row(o.account, o.market);
        r.asset -= a.assetSpent;
        r.cash += a.usdcOutput;
      }
    }
    if (l.eventName === "FeePaid") {
      const o = orders[String(a.order)];
      if (o) {
        const r = row(o.account, o.market);
        const isAsset = o.action === 1 || o.action === 3;
        if (isAsset) {
          r.asset -= a.amount;
          r.feesAsset += a.amount;
        } else {
          r.cash -= a.amount;
          r.feesCash += a.amount;
        }
        if (a.makerRebate > 0n)
          pendingRebates.push({
            order: a.order,
            amount: a.makerRebate,
            asset: isAsset,
          });
      }
    }
    if (l.eventName === "Claimed") {
      const r = row(a.account, a.market);
      r.cash += a.usdc;
      r.asset += a.asset;
      r.up -= a.up;
      r.down -= a.down;
    }
  }
  return { rows: [...rows.values()], orders };
}
