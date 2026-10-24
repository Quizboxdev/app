# Architecture review (Phase 1)

Diagrams, route inventory and the role matrix are in `docs/architecture/` (system-overview.md, api-inventory.md, role-permission-matrix.md).

Strengths (verified by reading and by the existing database tests)

* Authorization lives in the database: RLS on every table, writes only through role-checking `SECURITY DEFINER` functions with pinned `search_path`; anon has almost no access.
* Money handling is server-authoritative and idempotent (Coins x unit price, signed webhook, re-query, ledger ignoring duplicates).
* Recent migrations ship with a rollback (54 rollback files for 106 migrations), an idempotent re-apply test and a paste-part split for hand application.
* Tight scoping of risky features: student-created quizzes are constrained by triggers, not by screens.

Risks

1. **Silent failure pattern** (QB-AUD-002, 012): server reads return fallbacks without logging, hiding a production fault on the revenue page.
2. **Client-only route gating** (QB-AUD-006).
3. **Manual deployment of the database** (106 migrations pasted by hand): safe and reviewable, but drift between environments cannot be detected automatically; a periodic schema-diff job against Preview and production would close that gap.
4. **No CI** (QB-AUD-005) and 119 environment-dependent tests that nothing runs automatically.
5. **Working data inside the repository tree** (QB-AUD-003): question files, scratch and images mixed with source.
6. **Single point of key dependence**: the public site and checkout depend on one service-role key at runtime; a missing key degrades the site quietly.

Technical-debt register: see the end of system-overview.md and audit-findings.csv.
