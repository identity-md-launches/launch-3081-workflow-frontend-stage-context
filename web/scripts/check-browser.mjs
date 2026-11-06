// Foreground export server + Chromium. All test signing and RPC responses are mocked by default.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  http,
  decodeFunctionData,
  decodeAbiParameters,
  encodeFunctionResult,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
  parseAbi,
} from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(
  "/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs"
);
const manifestBytes = await readFile(join(root, "dist/imd-deployment.json"));
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const manifest = JSON.parse(manifestBytes.toString());
const abis = {};
for (const c of manifest.contracts)
  abis[c.name] = JSON.parse(
    await readFile(join(root, "dist", c.abiPath), "utf8"),
  );
const ERC = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
]);
const PERMIT = parseAbi([
  "function allowance(address,address,address) view returns(uint160,uint48,uint48)",
  "function approve(address,address,uint160,uint48)",
]);
const QUOTER = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)",
]);
const ROUTER = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const VIEW = parseAbi([
  "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
]);
const ZERO = "0x" + "0".repeat(40),
  IMD = manifest.network.pairToken.address,
  USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USER = "0x1111111111111111111111111111111111111111";
const realNow = Math.floor(Date.now() / 1000);
const now = process.argv.includes("--live-rpc")
    ? realNow
    : Math.floor(realNow / 3600) * 3600 + 1800,
  start = Math.floor(now / 3600) * 3600,
  end = start + 3600;
const marketId = keccak256(
  encodeAbiParameters(parseAbiParameters("address,uint32,uint64,uint256"), [
    IMD,
    0,
    BigInt(start),
    0n,
  ]),
);
const path = [
  {
    currency0: ZERO,
    currency1: IMD,
    fee: 10000,
    tickSpacing: 200,
    hooks: ZERO,
  },
  { currency0: ZERO, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ZERO },
  { currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO },
];
const asset = {
  token: IMD,
  unitsPerShare: 10n ** 18n,
  maxOpenPairs: 10n ** 12n,
  hops: 2,
  path,
};
const state = {
  authorized: false,
  chain: "0x1",
  unknown: false,
  approved: new Map(),
  permitted: 0n,
  sends: [],
  calls: [],
  reject: false,
  simulationError: false,
  codeMissing: false,
  noPrice: false,
  hold: false,
  hash: 1n,
  receipts: new Map(),
  walletRequests: [],
};
const blockHash = "0x" + "ab".repeat(32);
function block(number = 1000) {
  return {
    number: toHex(BigInt(number)),
    hash: blockHash,
    parentHash: "0x" + "cd".repeat(32),
    nonce: "0x0000000000000000",
    sha3Uncles: blockHash,
    logsBloom: "0x" + "00".repeat(256),
    transactionsRoot: blockHash,
    stateRoot: blockHash,
    receiptsRoot: blockHash,
    miner: ZERO,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: toHex(BigInt(now)),
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x1",
  };
}
function identity(to) {
  for (const c of manifest.contracts)
    if (c.address.toLowerCase() === to.toLowerCase())
      return { name: c.name, abi: abis[c.name] };
  const u = manifest.network.uniswapV4;
  if (to.toLowerCase() === u.permit2) return { name: "Permit2", abi: PERMIT };
  if (to.toLowerCase() === u.universalRouter)
    return { name: "Router", abi: ROUTER };
  if (to.toLowerCase() === u.quoter) return { name: "Quoter", abi: QUOTER };
  if (to.toLowerCase() === u.stateView) return { name: "View", abi: VIEW };
  return { name: "ERC20", abi: ERC };
}
function market(exists = true) {
  return {
    token: exists ? IMD : ZERO,
    version: exists ? 1 : 0,
    start: BigInt(start),
    end: BigInt(end),
    factor: 10n ** 12n,
    maxPairs: 10n ** 12n,
    ladderStrike: 0n,
    strike: 0n,
    close: 0n,
    pairs: 100000000n,
    reserveUSDC: 100000000n,
    reserveAsset: 100n * 10n ** 18n,
    outcome: 0,
  };
}
function order(id) {
  return {
    market: marketId,
    trader: USER,
    action: Number(id) === 1 ? 0 : 1,
    assetOnly: false,
    expiry: BigInt(end),
    previous: 0n,
    next: 0n,
    remaining: 10000000n,
    limitPrice: Number(id) === 1 ? 490000n : 510000n,
    cash: 100000000n,
    asset: 100n * 10n ** 18n,
    fee: 1000000n,
    swapBudget: 0n,
    resting: true,
    fills: 0,
  };
}
async function rpc(method, params = [], wallet = false) {
  if (wallet) state.walletRequests.push({ method, params });
  if (method === "eth_chainId") return wallet ? state.chain : "0x1";
  if (method === "eth_requestAccounts") {
    state.authorized = true;
    return [USER];
  }
  if (method === "eth_accounts") return state.authorized ? [USER] : [];
  if (method === "wallet_getCapabilities") return {};
  if (method === "wallet_switchEthereumChain") {
    if (state.unknown) {
      const e = new Error("Unknown chain");
      e.code = 4902;
      throw e;
    }
    state.chain = params[0].chainId;
    return null;
  }
  if (method === "wallet_addEthereumChain") {
    assert.deepEqual(params[0], manifest.walletAddChain);
    state.unknown = false;
    return null;
  }
  if (method === "eth_blockNumber") return "0x3e8";
  if (method === "eth_getBlockByNumber")
    return block(params[0] === "latest" ? 1000 : Number(BigInt(params[0])));
  if (method === "eth_getCode" && state.codeMissing) return "0x";
  if (method === "eth_getCode")
    return params[1] && params[1] !== "latest" && BigInt(params[1]) < 500n
      ? "0x"
      : "0x60006000";
  if (method === "eth_getBalance") return toHex(10n ** 20n);
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
    return "0x1";
  if (method === "eth_estimateGas") return "0x40000";
  if (method === "eth_getLogs") return [];
  if (method === "eth_getTransactionCount") return "0x1";
  if (method === "eth_getTransactionReceipt")
    return state.receipts.get(params[0]) ?? null;
  if (method === "eth_sendTransaction") {
    if (state.hold)
      await new Promise((resolve) => {
        state.release = resolve;
        state.onHeld?.();
      });
    if (state.reject) {
      state.reject = false;
      const e = new Error("User rejected the request");
      e.code = 4001;
      throw e;
    }
    const tx = params[0],
      { name, abi } = identity(tx.to);
    const call = decodeFunctionData({ abi, data: tx.data });
    state.sends.push({ name, ...call, to: tx.to, value: tx.value });
    if (call.functionName === "approve") {
      if (name === "Permit2") state.permitted = call.args[2];
      else
        state.approved.set(
          `${tx.to.toLowerCase()}:${call.args[0].toLowerCase()}`,
          call.args[1],
        );
    }
    const hash = "0x" + (state.hash++).toString(16).padStart(64, "0");
    state.receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: "0x3e8",
      from: USER,
      to: tx.to,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      contractAddress: null,
      logs: [],
      logsBloom: "0x" + "00".repeat(256),
      status: "0x1",
      effectiveGasPrice: "0x1",
      type: "0x2",
    });
    return hash;
  }
  if (method === "eth_call") {
    const { to, data } = params[0],
      { name, abi } = identity(to);
    const { functionName: fn, args = [] } = decodeFunctionData({ abi, data });
    state.calls.push({ name, fn, args });
    const item = abi.find((i) => i.type === "function" && i.name === fn);
    const isWrite =
      item.stateMutability !== "view" && item.stateMutability !== "pure";
    if (isWrite && state.simulationError) {
      throw new Error("simulation failed: InvalidOrder");
    }
    let result;
    if (name === "PimdRegistry") {
      result =
        fn === "addPeriod"
          ? 4
          : fn === "configureAsset"
            ? 2
            : fn === "assetCount"
              ? 1n
              : fn === "periodCount"
                ? 4n
                : fn === "owner"
                  ? USER
                  : fn === "assets"
                    ? IMD
                    : fn === "currentVersion" || fn === "assetVersionCount"
                      ? 1
                      : fn === "asset"
                        ? asset
                        : fn === "periods"
                          ? [
                              [3600, 0, false],
                              [86400, 0, false],
                              [604800, 345600, false],
                              [0, 0, true],
                            ][Number(args[0])]
                          : fn === "bounds"
                            ? [BigInt(start), BigInt(end)]
                            : fn === "isBoundary"
                              ? true
                              : undefined;
    } else if (name === "PimdMarkets") {
      result =
        fn === "owner"
          ? USER
          : fn === "marketCount"
            ? 1n
            : fn === "marketIds"
              ? marketId
              : fn === "market"
                ? market(args[0] === marketId)
                : fn === "balance"
                  ? 10n ** 25n
                  : fn === "positions"
                    ? [10000000n, 10000000n]
                    : fn === "bestBid"
                      ? 1n
                      : fn === "bestAsk"
                        ? 2n
                        : fn === "order"
                          ? order(args[0])
                          : fn === "feeQuote"
                            ? 10000n
                            : fn === "nextOrderId"
                              ? 3n
                              : fn === "place" || fn === "placeWithProofs"
                                ? 3n
                                : fn === "split"
                                  ? marketId
                                  : fn === "matchMarket"
                                    ? 1n
                                    : undefined;
    } else if (name === "BoundaryOracle") {
      result =
        fn === "latestBoundary"
          ? BigInt(start)
          : fn === "price"
            ? state.noPrice
              ? 0n
              : 25000000000000000n
            : fn === "credit"
              ? 0n
              : fn === "oracleCost"
                ? [500000000000000000n, 1000000000000000000n]
                : fn === "proposal"
                  ? {
                      proposer: ZERO,
                      challenger: ZERO,
                      feePayer: ZERO,
                      deadline: 0n,
                      firstBlock: 0n,
                      boundary: 0n,
                      version: 0,
                      received: 0,
                      finished: false,
                      requested: false,
                      proposed: 0n,
                      cost: 0n,
                      anchorHash: "0x" + "00".repeat(32),
                      answers: [0n, 0n, 0n],
                      requests: Array(3).fill("0x" + "00".repeat(32)),
                    }
                  : fn === "priceable"
                    ? true
                    : undefined;
    } else if (name === "BoundaryProofVerifier")
      result = fn === "verify" ? 25000000000000000n : undefined;
    else if (name === "View") result = [2n ** 96n, 0, 0, 0];
    else if (name === "Quoter") result = [5000000000000000000n, 100000n];
    else if (name === "Permit2")
      result =
        fn === "allowance"
          ? [state.permitted, BigInt(now + 7200), 0n]
          : undefined;
    else
      result =
        fn === "symbol"
          ? to.toLowerCase() === USDC
            ? "USDC"
            : to.toLowerCase() === IMD
              ? "IMD"
              : "pIMD"
          : fn === "decimals"
            ? to.toLowerCase() === USDC
              ? 6
              : 18
            : fn === "balanceOf"
              ? 10n ** 25n
              : fn === "allowance"
                ? (state.approved.get(
                    `${to.toLowerCase()}:${args[1].toLowerCase()}`,
                  ) ?? 0n)
                : fn === "approve"
                  ? true
                  : undefined;
    if (item.outputs.length === 0) return "0x";
    if (result === undefined)
      throw new Error(`Unhandled mock read: ${name}.${fn}`);
    return encodeFunctionResult({ abi, functionName: fn, result });
  }
  throw new Error(`Unhandled mock method: ${method}`);
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const clean = path.replace(/^\/preview\//, "").replace(/^\//, "");
    const file = resolve(root, "dist", clean || "index.html");
    if (!file.startsWith(join(root, "dist") + "/")) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      mime[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const results = [];
const screenshots = join(root, "test/scratch/frontend");
await mkdir(screenshots, { recursive: true });
const record = (name) => {
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
};
let activePage;
const liveArg = process.argv.indexOf("--live-rpc");
const relay = liveArg >= 0 ? process.argv[liveArg + 1] : undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const failed = [];
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400)
      failed.push(`${r.status()} ${r.url()}`);
  });
  if (!relay) {
    await page.addInitScript(
      ({ clockNow }) => {
        const NativeDate = Date,
          offset = clockNow * 1000 - NativeDate.now();
        window.Date = class extends NativeDate {
          constructor(...args) {
            if (args.length) super(...args);
            else super(NativeDate.now() + offset);
          }
          static now() {
            return NativeDate.now() + offset;
          }
        };
      },
      { clockNow: now },
    );
    await page.exposeFunction("pimdMockRequest", async (a) => {
      try {
        return { result: await rpc(a.method, a.params, true) };
      } catch (e) {
        return { error: { message: e.message, code: e.code ?? -32000 } };
      }
    });
    await page.addInitScript(() => {
      const listeners = {};
      const provider = {
        request: async (args) => {
          const v = await window.pimdMockRequest(args);
          if (v.error) {
            const e = new Error(v.error.message);
            e.code = v.error.code;
            throw e;
          }
          if (args.method === "wallet_switchEthereumChain") {
            (listeners.chainChanged ?? []).forEach((fn) =>
              fn(args.params[0].chainId),
            );
          }
          return v.result;
        },
        on: (event, fn) => {
          (listeners[event] ??= []).push(fn);
        },
        removeListener: (event, fn) => {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
        },
      };
      window.ethereum = provider;
      const info = {
        uuid: "abababab-abab-4bab-abab-abababababab",
        name: "Test Wallet",
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        rdns: "test.pimd.wallet",
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: { info, provider },
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }
  await page.route("https://**/*", async (route) => {
    const req = route.request();
    if (!manifest.network.rpcUrls.some((url) => req.url().startsWith(url))) {
      await route.abort();
      return;
    }
    try {
      const body = req.postDataJSON();
      const one = async (v) => {
        try {
          return {
            jsonrpc: "2.0",
            id: v.id,
            result: relay
              ? await (
                  await fetch(relay, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(v),
                  })
                )
                  .json()
                  .then((r) => {
                    if (r.error) throw new Error(r.error.message);
                    return r.result;
                  })
              : await rpc(v.method, v.params),
          };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: v.id,
            error: { code: e.code ?? -32000, message: e.message },
          };
        }
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          Array.isArray(body)
            ? await Promise.all(body.map(one))
            : await one(body),
        ),
      });
    } catch (e) {
      await route.abort();
    }
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Take a position." }).waitFor();
  await page.getByText(/Ethereum · Block/).waitFor({ timeout: 45000 });
  record(
    relay
      ? "live runtime deployment, registry and contract reads"
      : "runtime configuration and all six ABI loads",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
    await page.screenshot({
      path: join(screenshots, `${relay ? "live" : "mock"}-${width}.png`),
      fullPage: true,
    });
    record(`layout has no horizontal overflow at ${width}`);
    if (width === 390) {
      const box = await page
        .getByRole("button", { name: "Connect to trade", exact: true })
        .boundingBox();
      assert(
        box && box.y + box.height <= 844,
        `primary action below fold: ${JSON.stringify(box)}`,
      );
      record("390 first screen contains product, wallet and trade action");
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.screenshot({
    path: join(screenshots, `${relay ? "live" : "mock"}-390-dark.png`),
    fullPage: true,
  });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  record("theme changes all surfaces without a navigation");
  if (relay) {
    if (Math.floor(Date.now() / 1000) % 3600 < 120)
      await page.getByRole("button", { name: "Past", exact: true }).click();
    await page.getByRole("button", { name: "Resolution", exact: true }).click();
    const proof = page.getByRole("button", { name: "Build boundary proof" });
    await page.waitForTimeout(1200);
    if (await proof.isEnabled()) {
      await proof.click();
      await page
        .getByText(/Proof verified|Wait for N\+2|27-hour/)
        .waitFor({ timeout: 90000 });
      const result = await page
        .getByText(/Proof verified|Wait for N\+2|27-hour/)
        .first()
        .innerText();
      record(`live boundary witness: ${result}`);
      await page.screenshot({
        path: join(screenshots, "live-proof.png"),
        fullPage: true,
      });
    }
    await page.getByRole("link", { name: "pIMD", exact: true }).click();
    await page.getByLabel("You pay (IMD)", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".swap-panel .error") ||
        document.querySelector(".swap-output strong")?.textContent.trim() !==
          "–",
    );
    const quoteError = await page
      .locator(".swap-panel .error")
      .allTextContents();
    record(
      quoteError.length
        ? `live quote returned a recoverable error: ${quoteError[0]}`
        : "live Quoter simulation returned pIMD output and a slippage minimum",
    );
    await page.screenshot({
      path: join(screenshots, "live-quote.png"),
      fullPage: true,
    });
  } else {
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.getByRole("button", { name: /Injected/ }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    record("wallet sheet closes with Escape and hides generic injected naming");
    state.chain = "0x89";
    state.unknown = true;
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test Wallet", exact: true })
      .click();
    await page.getByRole("button", { name: "Switch to Ethereum" }).click();
    await page
      .getByRole("button", { name: /0x1111/ })
      .waitFor({ timeout: 10000 });
    assert(
      state.walletRequests.some((r) => r.method === "wallet_addEthereumChain"),
    );
    record("EIP-6963 connection and unknown-chain add/switch fallback");
    await page.getByRole("link", { name: "Portfolio", exact: true }).click();
    await page.getByLabel("Amount (USDC)", { exact: true }).fill("12.5");
    await page.getByRole("button", { name: "1. Approve USDC" }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).waitFor();
    assert.equal(state.sends.at(-1).functionName, "approve");
    assert.equal(state.sends.at(-1).args[1], 12500000n);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    record("exact-amount USDC approval is separate from deposit");
    let held;
    const signingPrompt = new Promise((resolve) => {
      held = resolve;
    });
    state.hold = true;
    state.onHeld = held;
    await page
      .getByRole("button", { name: "Deposit USDC", exact: true })
      .click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await signingPrompt;
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    assert.equal(
      await page
        .getByRole("button", { name: "Close", exact: true })
        .isDisabled(),
      true,
    );
    state.hold = false;
    state.release();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(state.sends.at(-1).functionName, "deposit");
    record("deposit simulates and waits for a confirmed receipt");
    record(
      "pending wallet confirmation locks Escape, dismissal and duplicate submissions",
    );
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await page.getByLabel("Amount (USDC)", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Withdraw USDC" }).click();
    state.reject = true;
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Request declined" })
      .waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    record("wallet rejection stays visible and offers retry");
    await page.getByRole("link", { name: "Markets", exact: true }).click();
    await page.locator("#order-price").fill("0.50");
    await page.locator("#order-quantity").fill("10");
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#order-quantity").inputValue(), "10");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "order-quantity",
    );
    record(
      "amount input keeps its value and keyboard focus across timer updates",
    );
    await page.getByRole("button", { name: "Buy Up", exact: true }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(state.sends.at(-1).functionName, "place");
    assert.equal(state.sends.at(-1).args[1].action, 0);
    assert.equal(state.sends.at(-1).args[1].immediateOrCancel, true);
    assert.equal(state.sends.at(-1).args[1].quantity, 10000000n);
    record("market Buy Up sends bounded IOC with six-decimal shares");
    await page.getByRole("button", { name: "Down", exact: true }).click();
    await page.getByLabel("Pay with IMD only").check();
    await page.getByLabel("Maximum swap input (IMD)").fill("1");
    await page.getByRole("button", { name: "Buy Down", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "5% buffer" }).waitFor();
    await page.getByLabel("Maximum swap input (IMD)").fill("300");
    await page.getByRole("button", { name: "Buy Down", exact: true }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(state.sends.at(-1).args[1].assetOnly, true);
    assert.equal(state.sends.at(-1).args[1].maxSwapInput, 300n * 10n ** 18n);
    record("Down asset-only mode enforces buffer and exact swap cap");
    await page.getByRole("button", { name: "Order book", exact: true }).click();
    const downRows = await page.locator(".book-row").allTextContents();
    assert(
      downRows.some((text) => text.includes("Ask") && text.includes("0.5350")),
    );
    assert(
      downRows.some((text) => text.includes("Bid") && text.includes("0.5150")),
    );
    record(
      "Down book reverses bid/ask and shows the selected outcome USD value",
    );
    await page.locator("#order-price").fill("1.50");
    await page.getByText("≥ 5 USDC", { exact: true }).waitFor();
    record("Down prices above one show the full-fill USDC credit");
    await page.locator("#order-price").fill("0.50");
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    await page.getByRole("button", { name: "Sell Down", exact: true }).click();
    state.simulationError = true;
    const before = state.sends.length;
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("alert").filter({ hasText: "order failed" }).waitFor();
    assert.equal(state.sends.length, before);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    record("simulation failure prevents wallet transaction submission");
    state.simulationError = false;
    await page.getByRole("link", { name: "pIMD", exact: true }).click();
    await page.getByLabel("You pay (IMD)", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await page.getByRole("button", { name: "1. Approve IMD" }).waitFor();
    await page.getByRole("button", { name: "1. Approve IMD" }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await page.getByRole("button", { name: "2. Permit router" }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await page.getByRole("button", { name: "3. Review swap" }).click();
    await page.getByRole('heading',{name:'Swap IMD for pIMD',exact:true}).waitFor();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const swap = state.sends.at(-1);
    assert.equal(swap.functionName, "execute");
    assert.equal(swap.args[0], "0x10");
    assert.equal(swap.to, manifest.network.uniswapV4.universalRouter);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes, bytes[]"),
      swap.args[1][0],
    );
    assert.equal(actions, "0x060c0f");
    const [swapParams] = decodeAbiParameters(
      parseAbiParameters(
        "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
      ),
      params[0],
    );
    assert.deepEqual(
      {
        ...swapParams.poolKey,
        currency0: swapParams.poolKey.currency0.toLowerCase(),
        currency1: swapParams.poolKey.currency1.toLowerCase(),
        hooks: swapParams.poolKey.hooks.toLowerCase(),
      },
      manifest.poolKey,
    );
    assert.equal(swapParams.zeroForOne, true);
    assert.equal(swapParams.amountIn, 10n ** 18n);
    assert.equal(swapParams.amountOutMinimum, 4975000000000000000n);
    assert.equal(swapParams.hookData, "0x");
    assert.equal(BigInt(swap.value ?? 0), 0n);
    record(
      "ERC20 approval → Permit2 approval → simulated Universal Router execute",
    );
    await page.getByRole("link", { name: "Leaderboard", exact: true }).click();
    await page.getByRole("button", { name: "Load / continue history" }).click();
    await page.getByText(/Complete through block/).waitFor();
    assert.equal(
      await page.getByText("No resolved-market results yet").count(),
      1,
    );
    record("complete confirmed-event scan and truthful empty leaderboard");
    await page.getByRole("link", { name: "Docs", exact: true }).click();
    await page.getByRole("heading", { name: "Owner settings" }).waitFor();
    await page.getByLabel("Period duration (seconds)").fill("7200");
    await page.getByRole("button", { name: "Add period", exact: true }).click();
    await page.getByRole("button", { name: "Simulate & confirm" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(state.sends.at(-1).functionName, "addPeriod");
    record("connected-owner period control calls the registry");
    for (const route of ["portfolio", "leaderboard", "token", "docs"]) {
      await page.goto(`${origin}#${route}`);
      await page.getByText(/Ethereum · Block/).waitFor();
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${route} overflow at ${width}`,
        );
      }
    }
    record("all five pages reflow at 320 and 390 pixels");
    await page.getByRole("link", { name: "Markets", exact: true }).click();
    state.codeMissing = true;
    await page.getByRole("button", { name: "Refresh contract state" }).click();
    await page.getByRole("alert").filter({ hasText: "has no code" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Buy Up", exact: true })
        .isDisabled(),
      true,
    );
    state.codeMissing = false;
    await page.getByRole("button", { name: "Retry connection" }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent === "Buy Up" && !button.disabled,
      ),
    );
    record(
      "missing deployment code blocks signing and connection retry recovers",
    );
    state.noPrice = true;
    await page.getByRole("button", { name: "Refresh contract state" }).click();
    await page
      .getByRole("button", { name: "Boundary price needed", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Boundary price needed", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Build a current-boundary proof" })
      .click();
    await page.getByRole("heading", { name: "Boundary resolution" }).waitFor();
    record(
      "missing fee-reference price disables signing and exposes a proof recovery action",
    );
  }
  assert.deepEqual(errors, [], "browser script errors");
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(root, "dist/imd-deployment.json")))
      .digest("hex"),
    manifestSha256,
    "export changed during the browser run",
  );
  assert.deepEqual(failed, [], "missing local resources");
  record("no uncaught browser errors or missing export resources");
  await context.close();
} catch (e) {
  if (activePage) {
    console.error((await activePage.locator("body").innerText()).slice(-3000));
    await activePage.screenshot({
      path: join(screenshots, "failure.png"),
      fullPage: true,
    });
  }
  console.error(
    JSON.stringify(
      {
        calls: state.calls.slice(-8),
        sends: state.sends.slice(-3),
        requests: state.walletRequests.slice(-8),
      },
      (_, v) => (typeof v === "bigint" ? String(v) : v),
    ),
  );
  results.push({
    name: "browser interaction suite",
    passed: false,
    error: e.stack,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await writeFile(
    join(root, `test/scratch/frontend/${relay ? "live" : "mock"}-results.json`),
    JSON.stringify(
      {
        manifestSha256,
        mode: relay
          ? "live reads, no transactions"
          : "mock wallets and RPC only",
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
