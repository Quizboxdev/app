# December 2026 release-readiness gate: evidence, defects, decision

Date: 2026-11-19. Code under test: `main` at 6dc95d6. Written for the owner and the engineers who will apply the correction.

## Decision: LIMITED GO for a supervised pilot on Production, after two read-only confirmations and two migrations; NO-GO for using Preview as a security test bed until its grants are fixed

Updated 2026-11-19 evening, after the gate ran on **Preview** and Production's live function text and policies were compared with the test database.
- **Production:** no P0. The two worst findings seen on Preview are absent there (profiles.role is not editable by a learner; browser roles hold no TRUNCATE). Production's policies match the test database except two read policies; its attempt functions were loaded into the test database and the gate re-run: 78 pass, 10 fail, the same 10 as before.
- **Preview:** a confirmed P0 (a learner could set their own role to admin) and open TRUNCATE on 183 tables. Cause: Preview was rebuilt with Supabase's default open grants. Production is not affected. Migration `20261120110000_reassert_browser_role_grants` closes it.
- Two P1 defects (one root cause, D-01) exist on Production's rules and are closed by `20261120100000_learner_profile_write_guards`.

| # | Condition for the pilot | Who | Status |
|---|---|---|---|
| 1 | Gate run on Preview | Owner | Done 2026-11-19: 13 fail, 75 pass (evidence/gate-preview-2026-11-19.txt) |
| 2 | Production checked read-only for the profiles rule, TRUNCATE, attempt functions | Owner | Done: profiles rule and TRUNCATE correct; attempt functions identical to Preview's |
| 3 | `december_gate_preflight_readonly.sql` on Production: no join codes shared across letter case; 0 learner-owned teacher profiles and classes | Owner | Not done |
| 4 | Apply `20261120100000` to Preview, then Production; apply `20261120110000` to Preview (Production: not needed); re-run the gate on Preview, expect 86 pass, 2 fail | Owner | Not done |
| 5 | Pilot learners under 13 are created through the managed learner flow until decision AG-07 | Owner | Decision needed |
| 6 | The file `01_Release_Readiness_Gate.md` was never found; if it sets extra checks or thresholds they were not applied | Owner | Send the file |

## What was run, and on what

The gate is `supabase/tests/december_readiness_gate.sql`: 88 checks in one transaction that ends in ROLLBACK, run as the real `authenticated` and `anon` roles with real JWT claims, so row-level security and grants apply exactly as in the app. It calls the real RPCs (`qb_join_class`, `qb_publish_assignment`, `qb_start_attempt`, `qb_save_response`, `qb_complete_attempt`, `qb_family_link_request`, and others). Nothing is mocked and no test was skipped. Data is synthetic: addresses end in `@e2e.quizbox.invalid`, ids start `d0a70000`.

**Databases used.** (1) Preview, run by the owner: `evidence/gate-preview-2026-11-19.txt`. (2) A local scratch PostgreSQL 18 made from the schema-only production dump of 2026-10-30 plus the repository migrations, then **overlaid with Production's exact function definitions** exported read-only on 2026-11-19 (672 functions; line endings normalised). Production's and Preview's policy fingerprints were compared with the scratch database: Preview equals Production; scratch differs from Production only in `learning_events_owner_read` and `mastery_owner_read` (both read-only rules) plus storage and cron policies the gate does not touch. Evidence: `gate-production-synced-before.txt` and `-after.txt`. No data was copied from any environment. The gate was never run on Production (it writes, even though it rolls back).

The first scratch run used repository functions that were older than the live ones; that made QZ-11 (another learner completing an attempt) look different. The test now checks the effect (attempt still open, no reward or learning event) instead of the absence of an exception, because the completion RPC reports some refusals as a JSON reply. With Production's functions it passes.

Also run: the new PGlite test for the correction (10 tests) and the static checks (10 tests, one marked `it.fails` for a known defect). `tsc --noEmit` and ESLint on the new files are clean. Full suite on this branch: 2,221 passed, 1 expected fail (MB-D1), 119 skipped (the live Preview tests, which need `.env.branch.local`, absent here). The first full run had 4 failures, all in the release-kit test that wants paste-ready parts for every new migration; they are added and the test passes.

## Results by area (Production-matched database: before the corrections / after)

| Area | Checks | Before | After |
|---|---|---|---|
| AU authentication and role boundaries | 12 | 10 pass, 2 fail | 12 pass |
| CL class creation | 4 | 2 pass, 2 fail | 4 pass |
| JN class-code joining | 10 | 10 pass | 10 pass |
| AS approved-content assignment | 9 | 9 pass | 9 pass |
| QZ quiz submission | 12 | 12 pass | 12 pass |
| TN cross-tenant isolation | 6 | 5 pass, 1 fail | 6 pass |
| RP reporting | 5 | 5 pass | 5 pass |
| GD guardian linking | 11 | 11 pass | 11 pass |
| AG age safeguards | 8 | 4 pass, 4 fail | 7 pass, 1 fail |
| EN pilot entitlement | 7 | 7 pass | 7 pass |
| MB mobile reliability (database side) | 4 | 3 pass, 1 fail | 3 pass, 1 fail |
| **Total** | **88** | **78 pass, 10 fail** | **86 pass, 2 fail** |

Full output: `evidence/gate-production-synced-before.txt` and `-after.txt`. Preview's own run is `evidence/gate-preview-2026-11-19.txt` (13 fail: the 10 above plus AU-03, AU-11 and a QZ-11 test flaw since fixed). Rollbacks were tested in both directions: the correction and the grants migration each flip the matching checks back and forth.

## Defects

Severity rule used: **P0** = another person's data exposed, administrator or money rights gained, or data destroyed. **P1** = a safeguard or authorization boundary can be bypassed by a signed-in user; fix before the pilot. **P2** = integrity or policy gap with limited reach; fix soon. **P3** = cosmetic or low value.

### P0: none on Production. One on Preview (D-05, below).

### P0 on Preview only, D-05: a learner could set their own role to admin, and browser roles held TRUNCATE on 183 tables
- Checks failing on Preview: AU-03, AU-11. Passing on Production (read-only comparison, 2026-11-19: only `full_name` is updatable on profiles; 0 of 198 tables with TRUNCATE).
- Cause: Preview was rebuilt with Supabase's default open table grants and never received the rule set by `20261002150000` (lines 231-232).
- Correction: `20261120110000_reassert_browser_role_grants` (revoke update on profiles, grant update(full_name); revoke TRUNCATE, REFERENCES, TRIGGER on every public table). No change on Production. Reproduced and proven on a scratch database given Preview's grants.
- Lesson recorded: a Preview rebuild must end with the grant rules; the gate's AU-03 and AU-11 now catch it.

### P1 D-01: a learner can give themselves a teacher profile and edit their own safeguarding flags
- Checks failing: AU-05, AU-05b, AG-01, AG-02, AG-08.
- Code path: `supabase/migrations/20260926180457_initial_quizbox_jhs_schema.sql:318-319`, policies `teacher_self` and `student_self` allow every command on the user's own row (`for all ... with check (user_id = auth.uid())`), and `authenticated` holds table-level INSERT, UPDATE and DELETE. Nothing in the app writes these tables from the browser (`lib/auth.ts:54,64` only reads), so the write access is unused by design.
- What a learner can do with a plain API call: insert a `teacher_profiles` row for themselves and then create classes (the `classes_insert` rule only asks for a teacher profile); set `is_minor = false` and `managed_by = null` on their own profile, or set `managed_by` to any adult. Those flags decide who may pay online (`app/api/payments/checkout/route.ts:46-47`), which features are blocked for minors (`public.qb_feature_allowed`), the partner-access consent block (`public.qb_pg_minor_blocked`), and whether another adult can link to the child (`public.qb_family_link_request`).
- Not exposed: other users' data, and no administrator right. A learner cannot reach any other learner through this.
- Correction: migration `20261120100000_learner_profile_write_guards.sql`: both policies become select-only and the browser roles lose INSERT, UPDATE and DELETE on both tables. Server functions (SECURITY DEFINER) and the service role are untouched.

### P2 D-02: a teacher can write an assignment row into another teacher's class (TN-06)
- Code path: `20260926180457_initial_quizbox_jhs_schema.sql:350`, `assignments_teacher_owner` checks only `teacher_user_id = auth.uid()`. The row is not visible to the class teacher or the learners (no recipient rows), but it sits in class A's data and can distort counts.
- Correction: same migration adds `qb_can_manage_class(class_id)` to the check.

### P2 D-03: two classes can share a join code that differs only by letter case (CL-03)
- Code path: unique index `classes_join_code_key` is case-sensitive; `quizbox_private.join_class_core` matches `upper(join_code)` and takes `limit 1`, so a learner could land in the wrong class. Needs the other code to be known, so reach is small.
- Correction: unique index on `upper(join_code)`; the migration refuses to apply and names the codes if duplicates already exist.

### P2 D-04: the browser chooses the class code and the server accepts any text (CL-04)
- Code path: `app/(app)/teacher/classes/page.tsx:11` builds a strong 12-character code, but the insert is a direct table write, so a changed client could set `A1`.
- Correction: trigger `class_join_code_guard` (10 to 64 letters, numbers, hyphens) checked only when a code is new or changed, so existing classes with older short codes can still be renamed or archived.

### P2 AG-07: a self-registered under-13 learner can join a school class with no guardian or consent record
- Code path: `quizbox_private.join_class_core` has no minor or consent check; the teacher then sees the child's name and email in the roster (`qb_class_roster_page`). This is a policy question, not a code slip, so no correction is shipped. Options: refuse the join until a guardian link or school consent exists for `is_minor` learners (recommended), or accept it and document it in the privacy notice. Condition 4 above is the pilot-time mitigation.

### P2 MB-D1: answers waiting for the network are lost if the phone reloads or kills the tab
- Code path: `lib/assessment/save-queue.ts` keeps pending answers in memory only; `app/(app)/student/attempt/[id]/page.tsx:48`. The attempt itself resumes (QZ-02 passes) but unsaved answers do not. A known-defect test marks it (`it.fails` in `lib/operations/december-gate.test.ts`).
- Recommendation: mirror pending answers to `sessionStorage` keyed by attempt id and replay them on resume.

### P3 MB-04: an attempt that ran out of time with no answers still earns 20 XP
- Code path: `qb_complete_attempt` inserts `ASSIGNMENT_COMPLETION` unconditionally (`20261002170000_production_readiness_security.sql:588`). Recommendation: award it only when at least one question was answered.

### Verified controls worth keeping (all pass)
Anonymous users read nothing and run no RPC; a learner cannot become administrator, edit feature flags, read others' profiles, answer keys or subscriptions, or forge a result, reward or score; join codes are rate limited (10 a minute), level-checked, expiry-checked and case-insensitive; only approved active questions from the chosen topic can be assigned (`INSUFFICIENT_APPROVED_QUESTIONS` otherwise); late joiners receive existing class work; attempts resume after a reload, enforce the attempt limit and the deadline, score on the server and cannot be submitted twice for a second reward; teachers see only their own classes, rosters and insights (IDOR attempts on attempts, reviews and rosters all refused); guardian links need the learner's acceptance, cannot be self-approved or forged, give no access to answer reviews, and end at once on revoke; a missing email gives the same answer as a real one; a sponsor link to a managed child waits for staff verification; the pilot grant lifts the free-allowance block, ends on expiry and on revoke, and cannot be self-granted; every public table has row-level security and no browser role can truncate.

## Not covered (be honest about the gap)
Signed-in browser journeys, real phones and slow networks, email delivery, Paystack payments, challenge and competition flows, performance under a full class, Production itself (the gate is never run there), and any drift between the scratch database and the live ones.

## How to run
```
C:\Users\USER\dev\codebase\scripts\readiness\run-december-gate.ps1 -Target Preview
```
It asks for the Preview password and the phrase `RUN GATE ON PREVIEW`, refuses Production, and prints the evidence. To rebuild the local scratch database: `scripts/readiness/build-scratch-db.sh <schema-only-dump.sql>` and run with `-Target Local`.

## Rollback
- The gate: nothing to undo. Check afterwards with `select count(*) from public.profiles where email like '%@e2e.quizbox.invalid'` (expect 0).
- The correction: `supabase/rollback/learner_profile_write_guards.sql` (one transaction). It restores the old rules, including D-01 to D-04, so use it only if the correction breaks a screen. Then fix forward. Tested on the scratch database in both directions.
