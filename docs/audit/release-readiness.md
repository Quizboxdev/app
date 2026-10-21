# Release readiness and quality gates (Phase 12)

## Gates

| Gate | Result | Basis |
|---|---|---|
| 1 Repository and feature inventory complete | PASS | repository-inventory.md |
| 2 Critical security checks complete | PARTIAL: static checks PASS; live authorization probes BLOCKED | security-review.md |
| 3 Core business journeys executed | BLOCKED (no accounts / Preview access); DB-level behaviour covered by automated tests | functional-qa-report.md |
| 4 Question bank and scoring validated | PARTIAL: files structurally validated, no defects of consequence; database comparison and scoring re-execution BLOCKED | curriculum-data-quality.md |
| 5 Essential automated tests passing | PASS (1,186 passed, 0 failed; 119 live tests skipped) | evidence/baseline-vitest.json |
| 6 Significant browser flows validated | BLOCKED for signed-in flows; public pages PASS except pricing content (FAIL) | screenshots |
| 7 User guides aligned with the actual UI | PARTIAL: public guide only; role guides BLOCKED (need screenshots from the real build) | user-guides/index.md |
| 8 Intern beta manual operationally complete | PASS (documents complete; scripts run on Preview) | docs/beta-testing |
| 9 Critical defects documented and triaged | PASS: 0 P0, 2 P1, 5 P2, rest P3 | audit-findings.csv |
| 10 Findings and PR evidence traceable | PASS | evidence-manifest.md |

## Decisions

**Engineering readiness: CONDITIONAL.** No P0, strong database-side controls, a green automated suite. Conditions: resolve QB-AUD-002 (live pricing and challenge data missing), deploy the QB-AUD-001 fix, resolve QB-AUD-003 (repository history), and run the BLOCKED authorization and journey checks on Preview.

**Supervised beta test readiness: CONDITIONAL.** A supervised beta with disposable Preview accounts can start now using the beta kit, because it does not depend on the production pricing page. A beta that includes real payments or public sign-ups must wait for conditions 1 to 3 above plus one end-to-end Paystack test-mode payment (PAY-01) and a two-account isolation pass (SEC-01 to SEC-04).

## Release blockers

1. QB-AUD-002: production pricing page and challenge list are not showing live data (cause unconfirmed).
2. QB-AUD-001: Challenges link bounces users (fix ready, not deployed).
3. QB-AUD-003: wrong files in `main` history (decision pending; not a security blocker).

## PR plan (nothing opened remotely)

* PR A, "Audit documentation and beta kit": docs/audit, docs/architecture, docs/user-guides, docs/beta-testing, scripts/audit.
* PR B, "Safe fixes with regression tests": AppShell allow-list (+ test), pricing and challenge list error logging (+ test).
* PR C (proposal only): CSP enforcement, CI workflow, server-side route guard, rate limit on view counter.

Each PR description should carry: rationale, files, defects addressed (IDs above), tests run (1,186 plus the new tests), screenshots (public pages), risk (low for A and B), rollback (revert the commit), and the reviewer checklist in `docs/beta-testing/regression-checklist.md`.
