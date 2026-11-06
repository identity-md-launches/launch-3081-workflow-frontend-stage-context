import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(web, ".cache"), { recursive: true });
for (const name of ["domain", "ledger"])
  await build({
    entryPoints: [resolve(web, `src/${name}.ts`)],
    outfile: resolve(web, `.cache/${name}.mjs`),
    platform: "node",
    format: "esm",
    bundle: true,
    packages: "external",
  });
const { feeQuote, escrow, bounds, amount, marketId, ladderTargets } =
  await import("../.cache/domain.mjs");
const { ledger } = await import("../.cache/ledger.mjs");
let count = 0;
function check(name, fn) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}
check(
  "decimal parser rejects rounding, negative, exponent, zero and excessive precision",
  () => {
    for (const v of ["0", "-1", "1e2", "1.0000001", "NaN", ""])
      assert.throws(() => amount(v, 6));
    assert.equal(amount("1.000001", 6), 1000001n);
  },
);
check("calendar leap year and Monday UTC boundaries", () => {
  const monthly = { calendarMonth: true };
  const [a, b] = bounds(monthly, Date.UTC(2028, 1, 29, 12) / 1000);
  assert.equal(b - a, 29n * 86400n);
  const weekly = {
    calendarMonth: false,
    secondsPerRound: 604800,
    offset: 345600,
  };
  const [w] = bounds(weekly, Date.UTC(2026, 10, 6) / 1000);
  assert.equal(new Date(Number(w) * 1000).getUTCDay(), 1);
});
check("all action escrows match contract rounding and fee coins", () => {
  const f = 10n ** 12n;
  assert.deepEqual(escrow(0, 10_000_000n, 500_000n, f, 100n, false, 0n), {
    usdc: 5_001_124n,
    asset: 0n,
  });
  assert.deepEqual(escrow(1, 10_000_000n, 500_000n, f, 100n, false, 0n), {
    usdc: 5_001_024n,
    asset: 10n ** 19n + 100n,
  });
  assert.deepEqual(escrow(1, 10_000_000n, 500_000n, f, 100n, true, 300n), {
    usdc: 0n,
    asset: 10n ** 19n + 400n,
  });
  assert.deepEqual(escrow(3, 10_000_000n, 1_500_000n, f, 100n, false, 0n), {
    usdc: 5_001_024n,
    asset: 100n,
  });
  assert.deepEqual(escrow(2, 10_000_000n, 500_000n, f, 100n, false, 0n), {
    usdc: 100n,
    asset: 0n,
  });
});
check(
  "fee quote integer floor/ceil stays exact over bounded values and extremes",
  () => {
    for (const p of [1n, 25n * 10n ** 15n, 10n ** 18n, 10n ** 30n])
      for (const x of [100n, 500000n, 1000000n, 2000000n])
        for (const quantity of [1n, 999999n, 1000000n, 999999999999n]) {
          const t = feeQuote(x, quantity, p, 10n ** 12n, true, false);
          const m = feeQuote(x, quantity, p, 10n ** 12n, false, false);
          assert(t >= m);
          assert(t >= 0n);
          const down = feeQuote(x, quantity, p, 10n ** 12n, true, true);
          assert(down >= 0n);
        }
    assert.throws(() => feeQuote(100n, 100n, 0n, 1n, true, false));
  },
);
check("market IDs distinguish period, start and ladder strike", () => {
  const s = {
    token: "0x1111111111111111111111111111111111111111",
    period: 0,
    start: 3600n,
    strike: 0n,
  };
  assert.notEqual(marketId(s), marketId({ ...s, period: 1 }));
  assert.notEqual(marketId(s), marketId({ ...s, strike: 10n ** 18n }));
  assert.equal(marketId(s), marketId({ ...s }));
});
check(
  "exact fee examples and clamped tails agree with the published curve",
  () => {
    assert.equal(
      feeQuote(500000n, 1000000n, 10n ** 18n, 10n ** 12n, true, false),
      26250n,
    );
    assert.equal(
      feeQuote(500000n, 1000000n, 10n ** 18n, 10n ** 12n, false, false),
      3750n,
    );
    assert.equal(
      feeQuote(500000n, 1000000n, 10n ** 18n, 10n ** 12n, true, true),
      26250000000000000n,
    );
    assert.equal(
      feeQuote(100n, 1000000n, 10n ** 18n, 10n ** 12n, true, false),
      1386n,
    );
    assert.equal(
      feeQuote(10000000n, 1000000n, 10n ** 18n, 10n ** 12n, true, false),
      1386n,
    );
  },
);
check(
  "ladder targets retain positive 18-decimal values and three significant digits",
  () => {
    for (const p of [1n, 10000n, 2464970000000000000n, 10n ** 30n])
      for (const text of ladderTargets(p)) {
        assert(!text.includes("e"));
        let n = amount(text, 18);
        assert(n <= 10n ** 30n);
        while (n % 10n === 0n) n /= 10n;
        assert(n <= 999n);
      }
  },
);
const U = "0x1111111111111111111111111111111111111111",
  D = "0x2222222222222222222222222222222222222222",
  M = "market";
const event = (eventName, args) => ({ eventName, args });
check(
  "rebates follow Solidity event ordering: fees emit before their Trade",
  () => {
    const logs = [
      event("OrderPlaced", { order: 1n, trader: U, market: M, action: 0 }),
      event("OrderPlaced", { order: 2n, trader: D, market: M, action: 1 }),
      event("FeePaid", { order: 1n, amount: 100n, makerRebate: 0n }),
      event("FeePaid", { order: 2n, amount: 700n, makerRebate: 175n }),
      event("Trade", {
        market: M,
        maker: 1n,
        taker: 2n,
        quantity: 1000000n,
        price: 500000n,
      }),
    ];
    const { rows } = ledger(logs, { [M]: 10n ** 12n });
    const u = rows.find((r) => r.account === U),
      d = rows.find((r) => r.account === D);
    assert.equal(u.cash, -500100n);
    assert.equal(u.asset, 175n);
    assert.equal(d.asset, -(10n ** 18n) - 700n);
    assert.equal(d.cash, -500000n);
    assert.equal(u.up, 1000000n);
    assert.equal(d.down, 1000000n);
  },
);
check(
  "split + merge conserve balances and shares; claims do not double count",
  () => {
    const {
      rows: [r],
    } = ledger(
      [
        event("Split", { market: M, account: U, quantity: 2000000n }),
        event("Merged", { market: M, account: U, quantity: 1000000n }),
        event("Claimed", {
          market: M,
          account: U,
          up: 1000000n,
          down: 1000000n,
          usdc: 1000000n,
          asset: 10n ** 18n,
        }),
      ],
      { [M]: 10n ** 12n },
    );
    assert.equal(r.cash, 0n);
    assert.equal(r.asset, 0n);
    assert.equal(r.up, 0n);
    assert.equal(r.down, 0n);
  },
);
check("asset-only swap costs are attributed to their order", () => {
  const {
    rows: [r],
  } = ledger(
    [
      event("OrderPlaced", { order: 3n, trader: D, market: M, action: 1 }),
      event("ShortFunded", {
        order: 3n,
        assetSpent: 20n * 10n ** 18n,
        usdcOutput: 500000n,
      }),
      event("Trade", {
        market: M,
        maker: 99n,
        taker: 3n,
        quantity: 1000000n,
        price: 500000n,
      }),
    ],
    { [M]: 10n ** 12n },
  );
  assert.equal(r.cash, 0n);
  assert.equal(r.asset, -21n * 10n ** 18n);
});
console.log(`${count} domain checks passed.`);
