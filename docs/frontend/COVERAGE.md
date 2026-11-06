# Frontend coverage of the deployed application

This stage preserves the deployed contracts. UI behavior is derived from the pinned implementation and exported ABIs, rather than from desired behavior absent from that implementation.

| Surface | Contract entry points / reads | Implementation |
| --- | --- | --- |
| Asset / period discovery | `assets`, `assetCount`, `currentVersion`, `asset`, `periods`, `periodCount`, calendar bounds | `web/src/state.tsx`, `domain.ts`, `market.tsx` |
| Four trading actions | `place`, `placeWithProofs`; explicit action enum, fee and swap budgets, expiry, hint, 1–64 steps | `web/src/market.tsx` |
| Mirrored book | `bestBid`, `bestAsk`, `order.next`; bounded linked-list pagination | `web/src/market.tsx` |
| Pair creation / release | `split`, `merge`, market snapshots, reserves and positions | `web/src/market.tsx` |
| Order maintenance | `matchMarket`, maker `cancel`, permissionless `expire` | Market controls and Portfolio open orders |
| Settlement / payout | `settle`, `claim`, `claimWithProofs`, `claimAll` (at most 64 loaded candidates) | Market maintenance and Portfolio |
| Funding | ERC-20 allowance / exact approval, `deposit`, free `balance`, `withdraw` | `web/src/portfolio.tsx` |
| Boundary evidence | `price`, `latestBoundary`, proof `verify`, oracle `prove`; three block headers, account/storage proofs, imported witness | `web/src/proof.ts`, `resolution.tsx` |
| Optimistic fallback | `proposal`, `oracleCost`, `propose`, `dispute`, `retryResolution`, `finalize`, `timeout`, `credit`, `withdrawCredit` | Resolution disclosure, exact bond approval |
| Application history | Economic events from deployed `PimdMarkets`; 12-confirmation range scan and reorg anchor | `web/src/indexer.tsx`, `portfolio.tsx` |
| Ranking | Net token flows, actual fees and rebates, swap cost, remaining settled entitlement | `web/src/ledger.ts`, `pages.tsx` |
| pIMD exchange | Runtime `poolKey`, configured Quoter simulation, input ERC-20 approval, Permit2 allowance/approval, Universal Router `execute` | `web/src/token.tsx` |
| Registry owner | Append `addPeriod` and `configureAsset` with immutable prior versions | Docs owner panel in `web/src/pages.tsx` |
| Deployment inspection | Exact addresses, attested ABIs, source/attestation identifiers, explorer links, download | Docs and `dist/imd-deployment.json` |

`PimdSwap.exactOutput` is an internal application flow invoked by `PimdMarkets`; the public page uses the contract's user-facing order input and does not offer a direct escrow bypass. `unlockCallback`, `onOracleResult`, `onFailure` and the oracle's self-only `requestResolution` are authenticated protocol callbacks, not visitor actions. Pure verifier/digest utilities are exercised as reads where needed rather than offered as transactions. LaunchToken has no owner, mint or configuration functions.

The approved token economics (50% burned, 35% pool, 10% swarm, 5% dev) are described as factory allocation policy, without claiming that LaunchToken itself implements distribution or trade fees. pIMD is a fixed-supply ERC-20. Future listing votes are a community promise displayed in the brief; no governance contract was supplied, so the page does not fabricate a voting control.

Worker validation uses mocked signing for economic actions and read-only live data for deployment, registry, asset price and boundary proof checks. Funded live trading, paid oracle disputes, third-party passkey/mobile wallet sessions and publication are outside that validation; see `VALIDATION.md` for exact evidence.
