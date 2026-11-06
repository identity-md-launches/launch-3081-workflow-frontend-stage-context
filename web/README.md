# pIMD frontend

Static Vite, React and TypeScript interface for the six deployed pIMD contracts. The publisher can host the repository-root `dist/` directory directly, including under an IPFS gateway subpath. Routing uses URL fragments; there is no application server.

## Install, build and preview

From the repository root:

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview
```

Vite uses `base: './'` and writes to `../dist`. The build generates the deployment manifest **after** Vite finishes. Do not edit files in `dist` by hand. Rebuild after changing an exported asset. Source, the npm manifest and lockfile are all in `web/`; root contract tooling is preserved. `node_modules`, caches and dependency archives are excluded by the explicitly allowed `web/.gitignore`.

## Deployment configuration

The browser fetches `./imd-deployment.json` and its referenced ABI arrays at startup. `src/config.ts` constructs the chain, public RPC client, contract interfaces and wallet configuration from that file. There is no second runtime address map. ABIs are checked with canonical JSON Keccak before loading the application; the configured chain and nonempty code at all six addresses are checked before signing is enabled.

`deployment-handoff.json` and `network.json` are preserved public build inputs copied from the assignment. They are used only by `scripts/export.mjs`, never imported into the browser. That exporter reads each ABI from the pinned deployed Git commit (or the implementation-derived `docs/abi` export for a source archive) and verifies its attested canonical Keccak. It copies the handoff identifiers, contract set, exact pool key and complete network / wallet-add-chain objects, then inventories every other exported file with lowercase SHA-256. `npm run check:export` repeats these bindings and exact file-inventory checks. The original contract exports remain in `docs/abi`.

All signing belongs to the visitor's wallet. There is no key, backend, project ID, provider credential or private RPC URL in the app. The USDC constant in `src/config.ts` comes from the approved contract specification. Listed assets, periods, owner, historical asset versions, balances and positions are read from the deployed implementation. Public RPCs, explorer and Uniswap addresses come from the runtime manifest's network block.

## Using the app

- **Markets:** choose an asset and period, Past / Now / Next, and Up/Down or an above-target ladder. The trade panel supports all four buy/sell actions, Market/Limit, price units, expiry, quantity, fees, a bounded sweep and insertion hints. It displays reserves and a conditional winning payout or gross sale estimate. USD estimates use the live onchain asset route; fee conversion uses the latest recorded boundary. Future targets are estimates. First orders create markets.
- **Balances:** approve an exact ERC-20 amount, then deposit in a separate transaction. Orders use free internal balances. Cancel, expire, merge and claim release funds to those balances; withdraw sends them to the wallet. Open-order escrow is not a free position.
- **Resolution:** build RLP headers and historical PoolManager account/storage proofs from the configured public RPC, validate them with the deployed verifier, and record them or retain them for an order/claim. Validated witnesses are held only in memory. The imported `build-proof.py` witness shape is supported. Proposal, bond approval, dispute, retry, finalization, timeout and oracle-credit withdrawal are exposed with their live conditions. Service callbacks are restricted contract-to-contract calls and have no visitor signing controls.
- **Portfolio:** loaded positions, claim/claim-all, cancellable or expired orders, funding and transaction history. Load additional market pages when more than 100 markets exist. Load confirmed event history to enumerate orders. Trade, fee, swap-funding and order-close events are associated with the wallet's order IDs.
- **Leaderboard:** fetch events from the discovered deployment block in bounded chunks, wait for 12 confirmations, deduplicate logs and recheck the saved anchor. Continue a partial scan before viewing rankings. Settlement PnL includes actual fees, rebates, collateral flows, swap costs and outstanding payout entitlement, valued at each market's closing boundary. Deposits, withdrawals, oracle bonds and gas are excluded. Open markets and refund markets without a USD close are excluded. Filters and sortable columns apply to the complete loaded history.
- **pIMD:** quote the exact attested pool, approve the input token to the configured Permit2, permit the configured Universal Router, then simulate `execute` before signing. Quotes expire after 45 seconds. The V4 command/action encoding, sorted currencies, initialization hook and minimum output are preserved. The prediction contract's separate exact-output Down route is invoked through its own `place` action; the browser never substitutes a route.
- **Owner:** the registry owner's connected address sees controls in Docs for new periods and complete future-asset configurations. Existing market snapshots are preserved. All original contract ownership and economics remain as deployed.

## Wallets and transaction states

The first-screen connect control discovers EIP-6963 extensions by name, offers Coinbase Wallet / Smart Wallet, and on a phone offers locally branded links into MetaMask, Coinbase Wallet, Rabby and Phantom. Wrong-network recovery first switches, then offers the handoff's exact `wallet_addEthereumChain` parameters for an unknown chain, then switches again. No WalletConnect project ID was supplied, so the pinned no-relay wallet path is used; no inert WalletConnect row is advertised.

Transactions have a review dialog, current-account/chain checks, contract simulation, wallet prompt, pending receipt, success and persistent recoverable error state. The modal remains locked while a transaction is being simulated, signed or confirmed. A changed account requires a new review. Approvals do not silently submit deposits or swaps. No funded real transaction was authorized for frontend validation.

## Validation

```sh
cd web
npm run typecheck
npm run build
npm run check:export
node scripts/check-domain.mjs
```

On the assigned worker, from the repository root, using its existing Playwright and Chromium installation:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node web/scripts/check-browser.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

The browser harness owns and closes its foreground HTTP server and browser, serves the export under `/preview/`, mocks wallet signing and JSON-RPC for interaction checks, and writes scratch evidence. Its optional `--live-rpc <read-only RPC URL>` path exercises live reads and proof building without connecting a wallet or sending transactions. The pinned taste probe is an assignment input and may not be available in an ordinary source archive. Both browser scripts import the worker's provided Playwright module; other environments can adapt that import to their existing installation.

See [validation](../docs/frontend/VALIDATION.md), [design system](../docs/DESIGN.md) and [feature coverage](../docs/frontend/COVERAGE.md). The root `DESIGN.md` requested in background criteria is placed at `docs/DESIGN.md` because the assignment's overriding write scope excludes repository-root files.

## Operational limits

Public RPC availability, historical `eth_getProof`, wallet application links and Coinbase passkey flows depend on their respective providers. No backend or archive subscription is provisioned. Read errors are shown with retry controls; invalid or unavailable dependencies prevent signing. The boundary chart shows recorded events from the last 10,000 blocks, not invented intraround candles. The history scanner advances up to 80 bounded chunks per request and can be continued; nothing claims a complete ranking while partial. The browser holds indexing state in memory and rechecks its confirmed anchor. Refreshing the page starts indexing again.

Prices are conditional estimates, not a fiat oracle for ETH gas or a guarantee of profit. The live asset spot is distinct from the contract's recorded settlement price. The site implements no offchain governance backend and does not claim that an independent security audit has been performed. See the existing `docs/SECURITY.md` for the contract contributor's security handoff. Publication, IPFS pinning, naming and the control plane's immutable/named-asset checks occur after worker delivery.
