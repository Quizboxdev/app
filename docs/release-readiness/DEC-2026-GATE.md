# December 2026 release-readiness gate: evidence, defects, decision

Date: 2026-11-19. Code under test: `main` at 5abac1d (after PR #115). Written for the owner and the engineers who will apply the correction.

## Decision: LIMITED GO (conditional, supervised pilot only)

Not a full GO, not a NO-GO. No P0 defect was found: no test showed one user reading another user's data, reaching administrator rights, or moving money. Two P1 defects (one root cause) let a signed-in learner change their own safeguarding flags and create classes; a one-migration correction is written and proven. A supervised school pilot may start once the conditions below are met.

| # | Condition for the pilot | Who | Status |
|---|---|---|---|
| 1 | Run the gate on **Preview** (command below). Expect the same 10 failures as the "before" column: that confirms Preview carries the same rules as the scratch database. | Owner | Not done: this session could not reach Preview |
| 2 | Run `supabase/tests/december_gate_preflight_readonly.sql` on **Production** (read-only) and confirm section 3 shows no codes shared across letter case, and section 4 shows 0 for "teacher profiles owned by a learner account" and "classes whose owning teacher account is a learner account". | Owner | Not done |
| 3 | Review and apply migration `20261120100000_learner_profile_write_guards.sql` to Preview, re-run the gate (expect 86 pass, 2 fail: AG-07 and MB-04 only), then apply to Production. | Owner, Claude prepares the scripts | Not done |
| 4 | Pilot learners under 13 are created through the **managed learner** flow (teacher or parent provisions them), never self-registered, until decision AG-07 is made. | Owner | Decision needed |
| 5 | The gate file named in the brief, `01_Release_Readiness_Gate.md`, was **not found** on this computer or in Google Drive. The checks follow the brief's list. If the file sets thresholds or extra checks, they were not applied. | Owner | Send the file |

## What was run, and on what

The gate is `supabase/tests/december_readiness_gate.sql`: 88 checks in one transaction that ends in ROLLBACK, run as the real `authenticated` and `anon` roles with real JWT claims, so row-level security and grants apply exactly as in the app. It calls the real RPCs (`qb_join_class`, `qb_publish_assignment`, `qb_start_attempt`, `qb_save_response`, `qb_complete_attempt`, `qb_family_link_request`, and others). Nothing is mocked and no test was skipped. Data is synthetic: addresses end in `@e2e.quizbox.invalid`, ids start `d0a70000`.

**Database used: a local scratch PostgreSQL 18, not Preview.** The Supabase connector in this session sees no QuizBox project, and no Preview credentials exist on this computer. The scratch database is the schema-only production dump of 2026-10-30 (`dev\fp\prod_schema.sql`: 208 tables, 172 policies) plus every migration in this repository applied in order (581 functions, 173 policies). 38 migration files stopped with "already exists" because the dump already contained them; 5 older migrations stopped on their own pre-checks for the same reason. No data was copied from any environment. Drift between this scratch database and Preview or Production is possible: that is why condition 1 exists.

Also run: the new PGlite test for the correction (10 tests) and the static checks (10 tests, one marked `it.fails` for a known defect). `tsc --noEmit` and ESLint on the new files are clean. Full suite on this branch: 2,221 passed, 1 expected fail (MB-D1), 119 skipped (the live Preview tests, which need `.env.branch.local`, absent here). The first full run had 4 failures, all in the release-kit test that wants paste-ready parts for every new migration; they are added and the test passes.

## Results by area (before the correction / after)

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

Full output: `docs/release-readiness/evidence/gate-before-correction.txt` and `gate-after-correction.txt`. After applying the rollback file the gate returned to 78 pass, 10 fail, and applying the correction again returned it to 86 / 2, so the rollback was tested in both directions.

## Defects

Severity rule used: **P0** = another person's data exposed, administrator or money rights gained, or data destroyed. **P1** = a safeguard or authorization boundary can be bypassed by a signed-in user; fix before the pilot. **P2** = integrity or policy gap with limited reach; fix soon. **P3** = cosmetic or low value.

### P0: none.

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
