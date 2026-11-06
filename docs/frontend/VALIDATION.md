# Frontend validation

Worker validation on 2026-11-06. **Complete for the assigned frontend scope**, with the live-signing and accessibility limits below. This is the implementation contributor's evidence, not independent certification or a contract security review.

## Delivered scope

`web/` contains the React/TypeScript source, Vite configuration, package manifest, lockfile, public build inputs and reproducible checks. `dist/` contains the static export and deployment manifest. Documentation and retained evidence are in `docs/`. No existing tracked source, contract, test, library, root build configuration or lockfile was changed. The worker leaves Git staging/commit to the network.

The overriding write scope excludes repository-root files, so the requested design document is delivered at [`docs/DESIGN.md`](../DESIGN.md). The frontend uses one runtime deployment file rather than importing its build-only handoff copies. Unknown prices, absent orders, unconfigured wallet states and failed reads have explicit non-signing states. WalletConnect has no supplied project ID; the pinned EIP-6963, wallet-browser and Coinbase Smart Wallet paths are implemented.

## Checks executed

| Check | Result | Evidence |
| --- | --- | --- |
| `cd web && npm run typecheck` (also part of final build) | Passed | Strict TypeScript checking of source and frontend configuration |
| `cd web && npm run build` | Passed | Production Vite export, followed by ABI/manifest generation; 18 inventoried assets |
| `cd web && npm run check:export` | Passed | Six pinned canonical Keccak ABI bindings; exact asset inventory and SHA-256 checks |
| Direct pinned-input comparison | Passed | [`integrity.json`](integrity.json): exact original handoff identifiers, full contract set, pool key, network and wallet-add-chain objects; permitted manifest keys only |
| `node web/scripts/check-domain.mjs` | 10 checks passed | Decimal rejection/precision, calendar leap year and Monday boundaries, all four escrows, exact fee examples and clamping, bounded fee cases, market IDs, tiny/large ladder targets, event-order rebate attribution, conservation and short-swap costs |
| `PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node web/scripts/check-browser.mjs` | 26 checks passed | [`mock-results.json`](mock-results.json), bound to the final deployment-manifest SHA-256 |
| Browser harness with its read-only live-RPC mode | 10 checks passed; no wallet connected | [`live-results.json`](live-results.json), bound to the same final manifest |
| Pinned `taste.mjs --out test/scratch/taste --offline` | 16/16 passed | [`taste-summary.json`](taste-summary.json) |
| Submission scope and size | Passed | New deliverables remain inside `web/`, `dist/`, `docs/` and explicit `web/.gitignore`; dependency/cache directories and archives are ignored; total additions below 8 MiB |

The final export is about 1.57 MB; the exact byte count and manifest digest are in `integrity.json`. Every exported file other than `imd-deployment.json` is inventoried, including `index.html`, all six ABIs, local marks and the 1200 × 630 PNG share image. Each file is below 8 MiB and the asset count is below 128. The export is far below half of the publication checker's 64 MiB response budget.

The final build emits upstream Rollup pure-annotation warnings from wallet dependencies, and npm reports a transitive peer-range warning. These did not prevent typechecking, building or executing the browser tests. No build exception, suppressed browser error or fake test result was used to obtain the reported passes.

## Browser and interaction coverage

The harness serves the actual production export at a `/preview/` subpath in one foreground process and closes its server and Chromium afterwards. The connector browser tool initially returned `Transport closed`; the installed Playwright/Chromium path supplied by the assignment was used directly instead. All screenshot observations below were made from real rendered output, not inferred from source.

The market page was checked at 320, 390, 768 and 1440 CSS pixels. All five pages were checked for horizontal overflow at 320 and 390. The 390 × 844 first screen contains the product, wallet control, market state and primary action; the harness checks the action's bounding box. Both light and dark themes were rendered. Mock fixtures deliberately include a very large asset price and wallet/free balances to stress numeric wrapping. No uncaught script errors, console errors or failed local resource loads remain in either the final mock or live run.

The mock clock is anchored midway through a round to avoid wall-clock boundary flakiness; the live browser clock is unchanged. The 26 mock checks include named EIP-6963 connection, unknown-chain 4902 recovery with exact add-chain parameters, Escape dismissal, exact USDC approval before deposit, confirmation receipts, wallet rejection, input focus across countdown updates, Up IOC, asset-only Down with its 5% swap buffer and exact cap, failed simulation preventing submission, and the complete three-transaction pIMD swap sequence. The swap's command, action bytes, full pool key, direction, amount, slippage minimum, hook data and zero ETH value are decoded and checked. A held wallet request confirms that pending transaction dialogs cannot be escaped or dismissed. Other checks cover confirmed event scanning, honest empty rankings, the connected owner's period control, missing contract code, missing fee-reference prices and recovery actions.

## Read-only mainnet observations

The configured network is Ethereum chain 1. Source endpoints are the public RPCs in `imd-deployment.json`: [PublicNode](https://ethereum-rpc.publicnode.com) and [dRPC](https://eth.drpc.org). Worker live reads used the task's contributor-provided read transport on behalf of those public endpoints; its private local address is neither bundled nor recorded here. This validates returned chain state and the browser's read/encoding path, not public-gateway availability or CORS from every visitor location.

The direct code check found nonempty code at all six handoff addresses: LaunchToken 1,503 bytes, PimdRegistry 5,094, BoundaryProofVerifier 6,919, BoundaryOracle 16,990, PimdSwap 4,090 and PimdMarkets 22,838. The browser repeated configured-chain and code verification before enabling transactions, read the registry's listings/periods and displayed the live IMD price from its fixed onchain route.

The browser built a three-block historical boundary witness, checked encoded header hashes and the closing anchor, obtained PoolManager account/storage proofs, and validated the result with the deployed `BoundaryProofVerifier.verify` using `eth_call`. It retained the verified witness without submitting `prove`. A separate live `quoteExactInputSingle` simulation returned positive pIMD output and a slippage minimum for the exact attested pool. No approval, deposit, swap, order, proof recording, claim, settlement, owner change or paid oracle request was broadcast to mainnet.

## Better Interface review

| Domain | Coverage | Evidence / limits |
| --- | --- | --- |
| Accessibility | Checked | Native controls, persistent labels, main/navigation landmarks, skip action, dialog name/focus implementation, visible focus styles, errors/status regions and keyboard Escape behavior reviewed; pending Escape lock and input focus tested. Probe target spacing passed. No screen-reader, physical-device or exhaustive keyboard session was performed. |
| Layout | Checked | Rendered widths 320/390/768/1440, all five pages at mobile widths, long fixture values, modal sizing and first-screen action checked. Probe found no overlap, clipping, sticky-cover issue or horizontal scroll. Native 200% zoom and RTL were not tested. |
| Writing | Checked | Rules, payout versus sale wording, fee coin, swap cap, free balances, approvals, unavailable state, empty books and recoverable errors reviewed against deployed behavior. Rankings state their valuation convention and exclusions. |
| Typography | Checked | Probe reports one declared family stack, weights 400/600/700, four sizes at 390 and five at 1440. Inputs remain 16 px; IDs and large values wrap. No external font is loaded. A particular installed fallback font is not asserted. |
| Colors | Checked | Probe's measured solid-background text passed 4.5:1, or 3:1 for large text, in its entry-page measurements. Both themes were visually inspected. This does not establish every dark-theme, hover, disabled, overlay or wallet-provider contrast pair. |
| UI | Checked | Empty/loading/error/pending/confirmed states, native dialogs, disabled prerequisites, exact approvals, restrained press feedback and instant theme change reviewed. Reduced-motion probe passed; no endless animations or `transition: all`. No native wallet popup/passkey or slow-motion animation-panel session was performed. |

The probe also passed metadata, casing, tracking, eyebrow labels, repetition, copy budget, surfaces and glyph checks. Its mobile entry measurement has 15 words of prose and its desktop measurement 38, within the pinned bars. Forty measured controls satisfy its 24 px / spacing rule; 35 are below the optional 44 px comfort size, reflecting the compact trading layout rather than a claim of universal touch-target compliance.

## Findings corrected

| Severity | Source | Observed issue and correction | Recheck |
| --- | --- | --- | --- |
| High | `web/src/state.tsx:286` | An already switched wallet could retain a missing/stale signer in a review closure. Resolve the current wallet client at confirmation and recheck the account and chain. | Unknown-chain add/switch followed by approval/deposit passed. |
| High | `web/src/portfolio.tsx:306`, `market.tsx:1068`, `token.tsx:350` | A connected wallet's balance reads could still be pending when a funding action became clickable, producing a false insufficient-funds error. Guard actions until required balances arrive. | The full connection → funding → trading sequence passes without timed user assumptions. |
| High | `web/src/token.tsx:60` | Resetting allowance values during a refresh could regress the displayed approval step and repeat Permit2 approval. Reset on account/currency changes only, retain reads during refresh, sequence responses, wait for fresh wallet reads before publishing a quote, and invalidate the quote after confirmation. | Exact ERC-20 → Permit2 → decoded router execution passed with fresh quotes. |
| High | `web/src/market.tsx:1068` | Trading needed an explicit readiness state for a missing fee-reference boundary. Disable signing and expose current-boundary proof recovery. | Missing-price mock produces the disabled state and opens Resolution. |
| Medium | `web/src/market.tsx:1455` | The Down book must reverse bid/ask labels and convert USD/coin values for the selected outcome. Correct both and include the pinned asset units per share. Down inputs above 1 USDC also show their full-fill cash credit in the reserve/profit context. | Regressions verify Down bids/asks, equivalent USD values and a 5 USDC cash credit for the test order. |
| Medium | `web/src/ledger.ts:16` | `FeePaid` precedes its `Trade`; attributing rebates to the previous trade would lose or misassign them. Queue each rebate and assign it when the matching Trade arrives. | Regression checks verify exact maker/taker token flows, including the first trade. |
| Medium | `web/src/wallet.tsx:36` | Native Escape could dismiss a pending dialog independently of React state. Prevent default cancellation and disable dismissal until pending work ends. | Held signing request keeps the modal visible and close control disabled; confirmation then completes. |
| Medium | `web/src/config.ts:140` | The wallet SDK's optional telemetry emitted network/console errors when unavailable. Disable telemetry through its supported preference. | Both final browser runs report zero console or page errors with non-RPC external requests blocked. |
| Medium | `web/src/domain.ts:78`, `styles.css:2303` | Very long fixture price/balance values could crowd narrow price regions. Use compact large-USD formatting and wrapping/min-width rules. | 320/390 stress renders and probe layout checks passed. |
| Low | `web/src/domain.ts:72` | The initial probe flagged em-dash placeholder glyphs in text. Use the ordinary missing-value en dash. | Final glyph check passed. |

The empty initial order-price field is an intentional financial-UX choice: a visitor enters a bound, rather than seeing a fabricated market quote. The mobile action-before-estimates layout is an implemented first-screen requirement, not a claim that an unobserved earlier screenshot failed.

## Retained evidence and remaining limits

- [`market-390.png`](market-390.png), [`market-390-dark.png`](market-390-dark.png), [`market-1440.png`](market-1440.png): full rendered live pages; the first 844 px of the mobile image correspond to the tested first screen.
- [`boundary-proof.png`](boundary-proof.png), [`token-quote.png`](token-quote.png): actual read-only proof verification and quote state.
- `mock-results.json`, `live-results.json`, `taste-summary.json`, `integrity.json`: worker results, with the browser results tied to the final manifest digest.

Funded wallet execution, gas economics, paid oracle proposals/disputes/callbacks, every settlement branch, physical mobile app links, Coinbase passkey sessions, populated live rankings and full assistive-technology compatibility remain untested. The existing implementation review is not converted into an independent audit by this frontend stage. Historic proofs and deployment-block discovery require a provider that serves the necessary historic state; the app exposes read failures and retry instead of inventing results. The boundary chart covers the latest 10,000 blocks. Position and history pagination are explicit, and incomplete history never produces a ranked leaderboard.

The share image is local and relative because the eventual IPFS gateway/name is not known yet. Absolute social URLs, source publication, fixed-CID/named-entrypoint checks and hosted-site availability belong to the later publisher stage and are not claimed here. No site was published and no contract was redeployed.
