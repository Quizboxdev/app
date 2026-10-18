# Production reconciliation, 18 October 2026

Input: the result of `17_production_missing_objects.sql` run on production (43 missing objects out of 404 the repository creates).

## Result
Production matches the repository except for **three migrations that were never applied**:

| Missing | Migration | What it holds | Who needs it |
|---|---|---|---|
| 38 objects | `20261007100000_core_platform_foundation` | `quizbox_core` schema, wallets and coins, payment intents and events, QPoints, badges and streaks, learner consent, account relationships (guardian, sponsor), platform settings, access entitlements, workspace switching, role listing | Payments (Phase 5), consent for under-13s, workspace chip in the app, any future guardian view |
| 1 function | `20261008100000_school_performance` | `quizbox_ops.school_performance` | The **School → Performance** page |
| 2 objects | `20261010110000_auth_failure_hardening` | `auth_failure_budget` table, `purge_auth_failures` | **Security:** per-source rate limit on sign-in failure logging and revoking direct table rights on `system_events` |
| 1 function | `20260926185133_question_import_merge_helper` | `public.merge_quizbox_question_import` | Nothing: an early helper the later question loader replaced. Left alone. |

This check lists missing tables, functions, views and schemas only. It does not see missing triggers, policies or grants; a second check for those is the next step after these three are applied.

## Plan
1. **Dry-run each migration inside a transaction that rolls back.** Nothing is kept. A clean "Success" means production can take that migration; an error shows exactly what differs from the repository. Files in `docs/release/engine/`: `18_dry_run_A_core_platform.sql`, `18_dry_run_B_school_performance.sql`, `18_dry_run_C_auth_failure_hardening.sql`.
2. **Apply for real** the ones that pass, in order A, B, C (the migrations themselves, with their own rollback files).
3. **Re-run the missing-objects query.** Expected result: zero rows apart from the legacy helper.
4. **Record the migrations in the production history** (tracker C3) so the history matches reality.

## Why this order matters
- `quizbox_core` is needed before the payment adapter and before consent for minors, so it is on the critical path of Phases 2 and 5.
- The auth-failure hardening is a security fix and should not wait.
