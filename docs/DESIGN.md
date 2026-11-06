# pIMD design system

This file lives under `docs/` because the assignment's overriding write scope excludes repository-root `DESIGN.md`. It documents the implemented frontend in `web/src`, with the static export in `dist/`.

## Overview

pIMD is a dense prediction-market interface for people managing USDC, IMD and outcome shares. Its Polymarket-inspired composition uses a compact product header, period/asset navigation, a market workspace, an independent trade panel and a grid of other timeframes. The brand is `(p)IMD`; the SVG mark is a bold lower-case p, green above and red below, on a dark rounded square.

Product and trade controls take precedence over introductory copy. The entry headline is “Take a position.” with the requested onchain banner. Empty books, absent prices and unavailable RPC responses are explicit states. Decorative hero linework is not a data chart. The actual chart only plots recorded boundary events. Order prices begin empty and require an explicit visitor bound; displayed book and ladder percentages come from live orders and recorded valuation.

## Colors

Canonical hexadecimal values are CSS custom properties at the top of `web/src/styles.css`. Components consume semantic names. The theme is selected on the document before React mounts, saved locally, and switched without color transitions by `toggleTheme` in `main.tsx`.

| Token / job | Light | Dark |
| --- | --- | --- |
| `--bg`, page | `#f8faf9` | `#101816` |
| `--surface`, panels and inputs | `#ffffff` | `#17211d` |
| `--surface-2`, secondary controls | `#f0f4f2` | `#1e2b25` |
| `--text`, primary text | `#172b25` | `#edf5ef` |
| `--muted`, secondary text | `#61736b` | `#a3b6aa` |
| `--border`, structural boundaries | `#e1e8e4` | `#304036` |
| `--accent` / `--positive`, primary and Up | `#08784d` | `#52d39b` |
| `--accent-hover` | `#05603d` | `#7be4b7` |
| `--accent-soft`, selected Up / navigation | `#e7f4ec` | `#1e362b` |
| `--negative`, Down and errors | `#ba3c42` | `#ff9a9e` |
| `--negative-soft`, Down / error surface | `#fbeded` | `#382628` |
| `--focus`, keyboard ring | `#2267d7` | `#8bb5ff` |
| `--hero`, introductory surface | `#edf5ef` | `#1c2e23` |

Primary button text is white in the light theme and `#10251b` in dark. Dark Down buttons use `#2c1415`. Up/Down labels, arrow icons, selected outlines and explicit status text duplicate color meaning. There is no gradient text. Rendered contrast results and their coverage limits belong in `docs/frontend/VALIDATION.md`; this document does not infer unmeasured contrast values.

## Typography

The interface uses one local/system sans stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`. Inter is used only if already installed; no font file or remote font request is shipped. Actual fallback appearance depends on the browser/platform.

The declared scale is 12, 14, 16, 20, 28 and 36 px (`--text-xs` through `--text-display`). The entry uses four or five of these sizes depending on width. Caption/metadata use 12; ordinary dense UI uses 14; inputs use at least 16, including on mobile; market headings use 20; page headings and desktop price values use 28. Generic display text has a 36 token, while actual page/entry headings select the smaller roles. Weights are 400, 600 and 700. Headings have the heaviest weight.

Body line-height is 1.6, compact headings 1.15–1.4. Large headings use −0.035em tracking and subordinate headings about −0.02em. There are no tracked capitals above headings. Long-form docs are capped near 75 characters. Address and large-number surfaces wrap; the market price formatter uses compact notation for very large USD values. Share confirmations retain all six decimal places. Changing numbers use tabular numerals; the countdown pads each time component.

## Layout

The main market shell has a 1536 px maximum and a 184 px period/asset sidebar. The workspace uses `minmax(0,1fr) 326px`, with a 24 px gutter. Other pages use a 1240 px maximum. Shared spacing is predominantly 8, 12, 16, 20, 24, 28 and 32 px, with smaller gaps for dense numeric controls. Text and controls keep mobile side margins of 16 px.

The CSS adapts at content-driven widths:

- Above 1600 px, the bounded market shell uses a 200 px sidebar, 350 px trade column and larger chart.
- At 1180 px, navigation and gutters tighten, the sidebar is 158 px and the trade column 300 px.
- At 960 px, the sidebar is replaced by asset/period selectors; header navigation becomes its own row.
- At 700 px, market content becomes one column. Product, schedule and price state appear first, then the order form. The primary trade action precedes the expanded financial estimates in visual order so it remains visible at 390 × 844. Chart, rules, resolution and pair maintenance follow. Portfolio, docs and token layouts also stack. The wallet dialog becomes a bottom sheet.
- At 360 px, the countdown takes a separate row and compact header/card details adapt further.

Market and boundary data refresh without remounting inputs. The chart retains a minimum height; icons and images declare dimensions. Mobile, tablet and desktop checks, including the 320 px reflow case and stress values, are recorded in validation. Native browser zoom, RTL and physical-device behavior are not implied by those viewport checks.

## Elevation & depth

This is a flat surface system. Panels, order controls and cards use structural borders and tonal layers rather than drop shadows. Modal dialogs alone have an elevation shadow (`0 16px 80px #0004`) and a dark translucent backdrop (`#09161099`). A selected card changes its border, not its elevation. No card combines a decorative shadow and border.

## Shapes

Inputs and ordinary buttons use 8 px corners. Cards use 12 px, main panels 14 px (12 on mobile), and dialogs 18 px. The mobile dialog rounds only its top corners. Wallet marks use 6 px corners; the brand image uses 10 px, reducing to 8 on small screens. Asset avatars are circular or compact 9 px rounded marks. These are component-specific shapes rather than a second radius system.

## Components

| Reuse point | Purpose and states |
| --- | --- |
| `WalletControl`, `Modal`, `TransactionDialog` in `wallet.tsx` | One wallet sheet shared by the header and disconnected actions. Named EIP-6963 rows, generic browser-wallet fallback, phone app links, Coinbase and account/disconnect details. Native dialog focus containment, Escape/backdrop dismissal and trigger focus restoration. Transaction dialogs lock dismissal while simulating, signing or pending, then expose confirmation or persistent errors. |
| `TradePanel` in `market.tsx` | Buy/Sell, Market/Limit, Up/Down, price-unit conversion, six-decimal share input, expiry, optional asset-only funding and advanced bounded matching/fee controls. Native selected buttons and labels, explicit spending review, no default market quote. Signing waits for balances and a fee-reference price or verified proof; a recovery control opens the current-boundary proof pane. |
| `MarketCard`, `LadderCard`, `OrderBook`, `BoundaryChart` in `market.tsx` | Market discovery, live bid/ask-derived Yes/No percentages, mirrored-side book and actual recorded price series. Unavailable quotes and history have named empty/error states. |
| `Funding`, `PositionRow`, `OpenOrder`, `HistoryStatus` in `portfolio.tsx` | Separate exact approval/deposit flow; free-balance withdrawal; position and order maintenance; chunked event indexing status. No internal-balance action silently approves a wallet token. |
| `Resolution` in `resolution.tsx` | Start/end selector, proof progress, witness import, verified proof recording and disclosed oracle/bond controls. Ineligible actions are disabled, with boundary and timing context beside them. |
| `TokenPage` in `token.tsx` | Explicit quote, amount, slippage and minimum output, followed by token approval, Permit2 permission and router swap. Quote expiry and confirmed transactions reset quote readiness; allowances remain visible while refreshed, preventing step changes during an update. |
| `OwnerSettings`, Docs and leaderboard in `pages.tsx` | Owner-only registry tools, readable deployment/rules information, sortable results and honest indexing/valuation boundaries. |
| `.primary`, `.segmented`, `.underline-tabs`, `.panel`, `.error`, `.data-list` in `styles.css` | Shared action, selection, navigation, surface, persistent error and numeric-row patterns. All controls retain native semantics and visible focus. |

Button state transitions name background, border and transform and last 120 ms only when reduced motion is not requested. Press scale is 0.96. Theme switches temporarily suppress transitions. There are no autoplay animations or page-entry motion. Disabled controls use native `disabled` and a visible opacity change; pending transaction state is announced in the dialog. A skip link focuses the existing main landmark without changing the selected page.

## Do's and don'ts

- Start another page with `.page-content`, `.page-heading` and the existing panel/reading primitives. Derive new financial state from the same runtime configuration and contract data.
- Use semantic theme tokens, the existing size scale and the three weights. Keep the action and the state it changes together, with a 16 px mobile inset.
- Preserve amounts as `bigint` through parsing, escrow, encoding and signing. Use display-only number formatting for estimates. Keep native token units distinct from USD estimates and recorded settlement values.
- Add a new signing action through the shared review/simulation/receipt path, and provide a visible error recovery step. Callback-only functions do not become visitor controls.
- Do not add remote assets, a second address map, invented market data, hidden approvals, fixed-height prose containers, new font families or animation loops. Keep unperformed checks in validation rather than presenting them as verified design behavior.

The final wallet configuration explicitly disables the Coinbase SDK’s optional telemetry. Balance-loading states block signing until required reads arrive, and retain the component structure and input focus.

The mirrored book reverses bid/ask and converts displayed value for the selected outcome. Down orders above a mirrored Up price of 1 USDC disclose the full-fill cash credit, and the potential-profit estimate includes that credit. Generic protocol interfaces are centralized with the runtime contract configuration in `web/src/config.ts`.

Potential profit uses the existing 20 px type role with an explicit positive/negative text color; the payout uses 28 px. Book cells can wrap long numeric values inside equal, zero-minimum grid columns. Wallet read requests are sequenced, and each fresh quote waits for a current allowance/balance read.
