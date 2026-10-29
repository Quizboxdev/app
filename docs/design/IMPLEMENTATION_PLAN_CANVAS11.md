# Canvas 11 implementation sequence

Base: `integrate/design-v02` (`6ee40fc`). Only DS `1791196207-241a` is permitted. The supplied route mapping and coverage CSV are preserved alongside this plan. Canvas 11 and the Canvas 09 corrections are design references; repository routes, protected RPCs and current workflows remain authoritative for implementation.

Every row is a separate reviewable change. No automatic merge, hosted migration or production deployment is authorized. Default-off flags must use the existing platform-settings architecture. OPEN_DECISIONS.md remains unresolved.

| Order | PR scope | Existing implementation / data | Acceptance or blocker |
| --- | --- | --- | --- |
| 0 | Portable baseline rollback test | `lib/school/performance-rollback.test.ts` | Normalize CRLF only; retain exact SQL comparison, object-removal and authorization assertions. |
| 1a | Help centre | `/help`, `HelpHome`, `qb_help_list`, `/api/help/search`, `qb_help_search` | Flagged Canvas 11 presentation; actual categories, views and counts; distinct error and empty states. Legacy page remains flag-off. |
| 1b | Help article | `/help/[slug]`, `HelpArticleView`, `HelpFooter`, `qb_help_get` | Keep published-content filtering, body rendering, related links, feedback and tracking. Do not infer unpublished status from a null RPC result. |
| 1c | Guides index | `/guides`, `bootstrapUser`, `audienceForRole`, `qb_help_list` | Keep the authenticated AppShell and audience filtering. Adapt the design inside that shell; do not turn the route public. |
| 1d | Guide article | `/guides/[slug]`, `qb_help_get`, `HelpArticleView` | Preserve protected-route behavior and existing article body contract. Derive steps from actual content only. |
| 1e | Opening | `/opening`, SessionGate, middleware homepage routing | Blocked on launch-interest route/contract conflict. Preserve session verification and role redirects. See BLOCKERS.md. |
| 1f–h | Terms, cookies, refunds | Existing PolicyRoute and published-policy reads | Separate route PRs. Preserve policy storage and legacy rendering; approved new structure uses clearly marked pending legal text, dates and contacts. Cookie switches require the actual consent-storage contract. |
| 2a | Affiliate | `/affiliate`, `lib/api/affiliates.ts` | Restyle existing affiliate/commission contracts only. Preserve eligibility, balances, payout methods and programme state. |
| 2b | Admin affiliates | `/admin/affiliates`, same RPC module | Keep owner-only switch. ConfirmDialog requires a note for approved supported actions; establish the existing Hold contract before wiring it. |
| 3a | Studio review Reject | Existing creator/review modules | Locate the precise review action and note argument first. Confirmation must pass a trimmed nonempty note to the existing RPC and preserve error recovery. |
| 3b | Admin campaign review Reject | Existing challenge moderation/admin modules | Same note and confirmation requirements; preserve authorization and supported state transitions. |
| 3c | Four-phase stepper | `WorkflowStepper`, existing creator flow | Locate the actual thirteen-step wizard before grouping Setup 1–2, Content 3–4, Competition 5–8, Launch 9–13. The existing five-step creator flow is not a substitute. |
| 4a | Pricing UI | `/pricing`, `lib/api/pricing.ts`, `qb_price_list`, existing seat APIs | Build segmentation around existing price configuration. No price-list writes or charging-logic changes in the UI PR. |
| 4b | Phase 1 pricing migration | Existing pricing/seat SQL and `lib/api/seats.ts` | Separate SQL PR with isolated database tests and rollback. Audit existing one-Coin seat charging first; never duplicate charges or apply migration. |
| 5a | Guardian journeys | Relationships/consent in `lib/api/core.ts` | Per-screen child-scoped contracts must be verified. Relationship records alone do not authorize progress access. |
| 5b | Studio / round player / wallet | Challenge start/submit APIs, existing attempt UI, wallet APIs | Reuse each supported workflow; list missing ledger, sync or detail contracts per screen before extending. |
| 5c | Rights / winners / tenant members | Challenge reports, awards and tenant membership data | Full detail and mutation contracts are required; existing list rows are insufficient for verification or permission-changing UI. |
| 5d | Certificates / leaderboards | Certificate prize type and existing leaderboard RPC | Issuance/verification and consent/minimum-population contracts must be established. No invented certificates, display approvals or ranks. |

## Gate for each UI PR

Run typecheck, ESLint, the complete Vitest suite and a production build. Validate the actual route in a running browser at CSS viewport widths 1440, 1024, 768, 390, 360 and 320. Save unchanged screenshots and viewport measurements; check horizontal overflow, keyboard focus, text contrast of at least 4.5:1, loading/empty/error states and flag-off parity. Label local fixture evidence explicitly. Authenticated runtime acceptance and hosted deployment checks remain separate from local fixture success.

Each PR report includes its base/head, changed-file inventory, actual commands/results, screenshots, unresolved contract/design gaps and release readiness. Environment reports contain variable names only.
