# Canvas 11 implementation blockers

Base audited: `integrate/design-v02`, `6ee40fc`. Design system: `1791196207-241a` only. Canvas 11 was accessed successfully in the authenticated browser. The route mapping and coverage update were copied unchanged before application edits. This is an audit, not a resolution of OPEN_DECISIONS.md.

| Screen / item | Evidence and constraint | Required resolution |
| --- | --- | --- |
| `/opening` | Existing page runs SessionGate for session verification and role redirects; middleware sends signed-in homepage traffic here. Canvas 11 depicts an interest-registration page. | Preserve SessionGate. Confirm a separate route for launch interest before adding that workflow. |
| Help topics | `lib/help/categories.ts` has eight actual categories, which differ from the board's labels. `qb_help_list` provides real articles and views. | Use actual categories and counts. Do not invent guardian articles or popularity. |
| Unpublished article state | The flagged index and article readers now preserve error versus empty/missing distinctions. `qb_help_get` still does not establish unpublished status when it returns null. | Preserve not-found behavior for null results. Do not infer or display an unpublished status without a supported contract. |
| Legal pages | PolicyRoute reads published policy text. The design contains pending-text placeholders. | Preserve the published-policy contract and flag-off output; never replace authoritative policies with invented terms. |
| Affiliates | `lib/api/affiliates.ts` uses existing affiliate and commission RPCs. Affiliate decisions support approve/reject/suspend/reinstate/terminate, not a generic hold action. | Identify the existing commission hold contract before wiring Hold. Keep programme-switch authorization unchanged. |
| Studio stepper | `/creator/new` currently has five steps and a student subset. Canvas specifies thirteen steps grouped into four phases. | Locate the thirteen-step implementation before grouping it. Do not create or reorder operational steps to fit a board. |
| Guardian screens | `lib/api/core.ts` has relationships and consent fields. Child-scoped progress, assignment and notification APIs were not established in the audit. | Verify each child-scoped RPC and RLS contract before adding a screen. Relationships alone do not authorize progress access. |
| Round player | `lib/api/challenges.ts` provides startChallenge and submitChallenge with server expiry and questions. An existing attempt UI also exists. | Reuse those contracts; establish sync/recovery and navigation semantics before adding any new server state. |
| Rights takedown | challenge_report and challenge_report_resolve exist. Full claimant, legal basis, item history and per-reference detail contract was not established. | Identify the detail contract; do not manufacture a claims case from a report row. |
| Winner verification | Awards list/update and fulfillment statuses exist. Verification checks, consent and attempt-event detail contract was not established. | Verify those sources before building the verification-detail screen. |
| Tenant members | Tenant membership tables and role helpers exist. Invitation, member mutation and last-admin protection API contract was not established. | Confirm existing protected RPCs and invariants; do not implement client-side permission substitutes. |
| Certificates | A certificate prize kind exists. Issuance, verification-code and verification-URL contracts were not established. | Identify issuance and verification backend before building the certificate page. |
| Leaderboards | Existing LeaderRow contains rank, name, score, duration and is_me. Approved display name, consent and minimum finisher contracts were not established. | Confirm publication policy and server-enforced eligibility before introducing the new view. |
| Pricing migration | Existing seat code already describes one Coin per participant with bundle/top-up limits. Pricing is read through qb_price_list. | Audit existing migrations and market price rows before drafting the separate ladder migration, tests and rollback. Never apply it. |

No listed gap is evidence that the entire backend feature is absent. A screen remains blocked until its complete contract is verified. No permission, legal, pricing, eligibility or policy decision is made here.
