# RELEASE_GATE_2026-12: evidence against `01_Release_Readiness_Gate.md`

Written for: the Product Lead and the sign-off group named in section 8 of the gate specification. Date of this record: 2026-11-19 (night). It is a record of evidence, not a claim that tests pass beyond what is listed.

## Recommendation: LIMITED GO

One pilot school, supervised, on the paths that were tested. **Not GO:** gates G0 (part), G1 (part), G4 (sampling), G7, G8 and G9 have no or only partial evidence yet (listed below). No open P0 or P1 defect remains on the paths tested.

Under the specification's own words: the NO-GO triggers (a P0/P1 touching children, cross-school access, scores, submission, entitlement or core onboarding; a promised parent flow that is missing; thin approved content) are **not triggered by anything tested**, but two of them cannot be ruled out without evidence we do not have: content coverage for the pilot grades (G4) and the parent flow as promised in launch material (E2E-11). The LIMITED GO therefore carries these conditions:

1. G4 audit run on Preview and Production: **done 2026-11-19**, every non-zero line explained below. Still to do: Curriculum QA sampling of the pilot grades.
2. Pilot grades and subjects chosen from where approved questions exist (the audit and the question-bank counts decide).
3. Family stays off for the pilot, or is switched on for all participating guardians, and the campaign wording matches (invariant 10).
4. A phone smoke test (G7) and the backup-restore drill (G8) done before the first school session.
5. Human support staffed for the pilot weeks.

## Identification

| Item | Value |
|---|---|
| Code under test | `main` at `50797ca` (pull request 118 merged) |
| Preview project | `fngdtxayfoiffbcbmcum` (gate run by the owner 2026-11-19, twice) |
| Production project | `fmgccmqxfjppqydkhaiu` (read-only checks only; the gate is never run there) |
| Deployment URL | not recorded in this session |
| Migrations from this gate | `20261120100000_learner_profile_write_guards` (Preview and Production applied), `20261120110000_reassert_browser_role_grants` (Preview applied; Production no-op), `20261120120000_xp_only_for_answers` (Preview applied and checked; Production pending) |
| Production migration history table | 83 rows, newest `20261018130000`: later migrations were applied by hand and not recorded; the history table cannot be used to prove state (known, separate repair) |
| Test totals | Gate: 90 checks, 89 pass, 1 accepted by the owner (AG-07), 0 fail, on the Production-matched database and on Preview (2026-11-19 22:29, after all fixes). Vitest: 2,227 passed, 0 failed, 119 live tests skipped |

## Release invariants (section 2)

| # | Invariant | Evidence | Status |
|---|---|---|---|
| 1 | School separation | TN-01 to TN-06, AU-01, AU-08, AU-09: another teacher sees no class, member, assignment, attempt or result; cannot rename, delete, add members or write assignment rows (TN-06 fixed) | PASS at database level; storage objects and exports not tested |
| 2 | Teacher scope | AS-06, AS-07, TN-05, RP-01 to RP-05: no cross-class publish, roster, review or breakdown | PASS; report exports not tested |
| 3 | Guardian scope | GD-01 to GD-11, AG-03 to AG-05: pending gives nothing, revoke is immediate, forged or self-approved links refused | PASS |
| 4 | Age safeguards | AG-01, AG-02, AG-05, AG-06, AG-08, AG-09 pass after D-01. **AG-07 accepted by the owner** (under-13 learners join a class with its code). Legal review of the safeguards: not part of this evidence | PASS with one owner-accepted behaviour; see "Open decisions" |
| 5 | Content integrity | AS-02, AS-04, AS-05: only approved active questions can be assigned. Production audit: 0 unapproved, 0 without provenance, 0 without a correct answer, 0 blank options, 0 without feedback, 0 without a topic, 0 grade mismatches; 8 duplicate-text groups; 5 withdrawn questions still inside 53 old test assignments (C10, below) | PASS on the audit; one policy question (C10) and 8 duplicates to clean |
| 6 | Attempt integrity | QZ-06 to QZ-12, MB-01 to MB-05: server scoring, one result and one reward per attempt, no forged scores, no foreign writes. Two truly simultaneous submits (E2E-08): **not run** (needs two connections) | PASS except E2E-08 |
| 7 | Entitlements | EN-01 to EN-07: free allowance, pilot grant lifts and then expires, revoke is immediate, no self-grant | PASS |
| 8 | Data minimisation | Service-role key is only in server files; no `NEXT_PUBLIC` secret (static search). Analytics payloads and error logs: **not inspected** | PARTIAL |
| 9 | Availability | No load test, no incident drill run | NOT RUN |
| 10 | Truth in promotion | Not assessed by tests | OPEN (condition 3) |

## Quality gates (section 3)

| Gate | Status | What exists | What is missing |
|---|---|---|---|
| G0 configuration, migrations | PARTIAL | RLS on every public table (AU-10); browser roles hold no TRUNCATE (AU-11); Preview drift found and fixed (profiles role editable, TRUNCATE on 183 tables); Production and Preview policy fingerprints equal; rollback files tested both ways | Vercel environment diff not run; migration history table lags on Production; no secret scan beyond the static search |
| G1 authentication | PARTIAL | Role boundaries and escalation (AU-01 to AU-08) | Recovery, reset, duplicate email, expired link: not run (need the auth service) |
| G2 classes and assignment | PASS (database level) | CL, JN, AS, QZ, RP all pass, including late joiner, attempt limit, deadline | Browser E2E not run |
| G3 privacy and security | PASS for what was tested | Cross-school negative tests on tables and RPCs; the two P1 and the Preview P0 closed | Direct HTTP API, storage, exports, red-team list (section 7) not run |
| G4 curriculum and SME | PARTIAL | Data audit run on Preview and Production 2026-11-19 (results below): no unapproved, answer-less, blank-option, feedback-less, topic-less or grade-mismatched active question on Production | Sampling of every advertised grade and subject by Curriculum QA; the 8 duplicate groups; coverage counts for the pilot grades |
| G5 parent linking | PASS (database level) | GD, AG-03 to AG-05 | "Existing learner request/acceptance" through the screens; approved child linking by staff through the screens |
| G6 payments, pilot access | PARTIAL | EN-01 to EN-07 | Bundle quotas, subscription purchase, duplicate payment event replay (E2E-18) |
| G7 reliability, mobile | PARTIAL | Install manifest, viewport, service worker rules, retry queue, reload persistence (fixed, tested); resume after reload, retry after dropped connection, deadline (MB-01 to MB-03) | No phone test, no 3G test, no 150-user load test, no p95 measurement |
| G8 analytics, operations | NOT RUN | Backup and restore scripts exist in the repository | Telemetry contract check, dashboard reconciliation, restore drill |
| G9 UAT | NOT RUN | none | 2 teachers, 2 guardians, 4 learners |

## Scenarios (section 4)

| ID | Status | Evidence or gap |
|---|---|---|
| E2E-01 teacher sign-up, free workspace | NOT RUN | needs the browser and an account |
| E2E-02 school interest stays pending | NOT RUN | the school review path is covered by earlier suites, not by this gate |
| E2E-03 class created, unique code | PASS (db) | CL-01 to CL-04 (codes now unique ignoring case and at least 10 characters) |
| E2E-04 wrong, expired, revoked code; guessing limited | PASS (db) | JN-04, JN-05, JN-06, JN-09 (10 tries a minute), JN-10 |
| E2E-05 learner sees only that class's work | PASS (db) | JN-01, TN-04, QZ-10 |
| E2E-06 assignment from approved questions | PASS (db) | AS-01 to AS-05 |
| E2E-07 start, save, resume, submit, feedback | PASS (db) | QZ-01 to QZ-06, MB-01 |
| E2E-08 two simultaneous submissions, one result | PARTIAL | QZ-07 (two sequential submits give one result and one reward); the attempt start takes a per-learner lock; a true concurrent test needs two connections |
| E2E-09 no score change or replay for rewards | PASS (db) | QZ-08, QZ-12, MB-05 |
| E2E-10 teacher report uses exact linked learners | PASS (db) | RP-01, RP-04, TN-02 |
| E2E-11 guardian sign-up; Family disabled message | NOT RUN | screens not tested |
| E2E-12 pending link reveals nothing | PASS (db) | GD-02, GD-03, GD-05 |
| E2E-13 reject, expire, unlink removes access | PASS (db) | GD-11 (revoke); expiry of a request not tested |
| E2E-14 under-13 protections, no public leaderboard or messaging | PARTIAL | AG-01 to AG-06, AG-08, AG-09 (managed child cannot join a challenge, is excluded from rankings). Self-registered children are not flagged as minors anywhere, so no age rule applies to them (see decisions). No chat feature exists in the code base |
| E2E-15 cross-school SELECT, INSERT, UPDATE, DELETE | PASS (db) | TN-01 to TN-06; storage objects and exports not tested |
| E2E-16 no draft or withdrawn question eligible | PASS (db) | AS-02, AS-04; withdrawn-after-assignment is audit check C10 (run on Production: only October test fixtures affected, see OD-3) |
| E2E-17 free allowance, pilot grants, subscription | PASS (db) | EN-01 to EN-04; purchase path not run |
| E2E-18 webhook replay cannot duplicate Coins or subscription | NOT RUN | existing payment suites cover replay in isolation; not part of this gate |
| E2E-19 relogin or reset exposes no earlier session data | NOT RUN | |
| E2E-20 slow or offline mid-submit, safe retry | PASS (code + db) | save-queue tests, reload persistence tests, MB-02, MB-03 |
| E2E-21 accessibility | NOT RUN | |
| E2E-22 real Android phones, throttled | NOT RUN | |

## Data and content audit (section 5)

`supabase/tests/december_data_audit_readonly.sql` (read-only, counts only) was run by the owner on Preview and Production on 2026-11-19.

| Check | Production | Preview | Reading |
|---|---|---|---|
| A1-A3, A5 orphans, duplicate enrolments, classes without grade | 0 | 0 | clean |
| A4 active enrolments in an archived class | 3 | 0 | archiving a class does not end enrolments; low impact |
| A6 learner enrolled at a different level than their own | 4 | 1 | older joins from before the level check; informational |
| B1-B8 attempts, results, rewards | 0 | 0 | clean (no ownerless, duplicate or over-limit attempts; no duplicate results or rewards) |
| B9 completion rewards on empty papers | 2 | 0 | history; the new rule (20261120120000) stops new ones |
| C1 active but not approved | 0 | 0 | clean |
| C2 approved with no reviewer | 0 | 75 | Preview only: the 75 seeded questions |
| C3-C8 answers, options, feedback, topic, grade | 0 | 0 | clean |
| C9 active questions with identical text | 8 groups | 2,555 groups | Production: content clean-up; Preview: test data |
| C10 withdrawn questions inside published assignments | 95 rows | 0 | see below |
| D1 subscriptions marked active past their end date | 4 | 2 | access follows the end date, so no one keeps access; status label only |
| D2-D7 grants and guardian links | 0 | 0 | clean |

**C10 explained (Production).** The 95 rows are 5 archived questions (4 approved, 1 in review) inside 53 published assignments. Every affected assignment is an October acceptance-test fixture ("Acceptance regression ...", "DEV_FACTORY_PILOT snapshot regression", "Secure Practice Acceptance"); the only attempts on them are 55 from a single account on 2026-10-01 and 2026-10-02. No school content is affected. Design note: an assignment keeps its own copy of each question, so a question withdrawn **after** an assignment is published is still served by that assignment (start-attempt reads the copy). That protects marks already given, but it means "withdrawn" does not reach assignments already out. Recommended policy: when a question is withdrawn, block new attempts on assignments that contain it and tell the teacher to republish; this is a product decision and was not built. Optional clean-up (needs the owner's approval): archive the 53 fixture assignments.

## Telemetry (section 6) and red-team list (section 7)

Not part of this evidence. Of section 7, these were exercised: user-id swaps (QZ-11, TN-05, GD-07), role claim edits (AU-03, AG-01, AG-02), class-code enumeration (JN-09), reuse of expired codes (JN-05), excessive attempts (QZ-09), forged results and rewards (QZ-12), direct table writes (TN-06, GD-05, EN-06). Not exercised: logout cache leakage, upload MIME and malware rules, HTML or prompt injection in question material, public search leakage, referral abuse, payment races, deletion and export privacy.

## Defect register

| ID | Sev | Area | Defect | Status |
|---|---|---|---|---|
| D-05 | P0 (Preview only) | Authentication | A learner could set their own role to admin; browser roles held TRUNCATE on 183 tables. Production already correct | Fixed on Preview (20261120110000) |
| D-01 | P1 | Age, authorization | A learner could create their own teacher profile and classes, and edit their own minor and managed-by flags | Fixed on Preview and Production (20261120100000) |
| D-02 | P2 | Cross-school | A teacher could write an assignment row into another teacher's class | Fixed (20261120100000) |
| D-03 | P2 | Class codes | Codes could repeat in a different letter case | Fixed (20261120100000) |
| D-04 | P2 | Class codes | The server accepted any class code, however short | Fixed (20261120100000) |
| MB-D1 | P2 | Mobile | Unsent answers were lost when the phone reloaded the page | Fixed in this pull request (browser storage queue, tested) |
| MB-04 | P3 | Rewards | A paper with nothing answered earned 20 points | Fix written in this pull request (20261120120000); pending apply. Rule is now "reward follows the answers" (MB-05) |
| AG-07 | owner decision | Age | Self-registered under-13 learners can join a class with its code | **Accepted by the owner 2026-11-19**: most Basic 4 to 6 learners are under 13; the class teacher stands for the school |
| OD-1 | open decision | Age | Age is not recorded at self-registration, so the minor safeguards cover school- and guardian-created accounts only. A self-registered child can join a public challenge and appear on its leaderboard as "First L." | Owner to decide (options below) |
| OD-2 | open | Evidence | G7, G8, G9, G4 sampling and most browser scenarios not run | Conditions above |
| OD-3 | open decision | Content | A question withdrawn after assignment is still served by the assignments that hold a copy (C10). Production has only test fixtures affected today | Owner to decide the policy (recommended: block new attempts and ask the teacher to republish) |

### Open decisions
- **OD-1.** Options: (a) keep as is; (b) show self-registered learners on public leaderboards by a nickname chosen by the teacher or by initials only; (c) ask for a birth year at sign-up and apply the minor rules. The invariant text ("no public leaderboard for under-13") is met for managed accounts only.

## Rollback

| Change | Rollback | Tested |
|---|---|---|
| 20261120100000 | `supabase/rollback/learner_profile_write_guards.sql` | both directions, scratch |
| 20261120110000 | `supabase/rollback/reassert_browser_role_grants.sql` (never on Production) | both directions, scratch |
| 20261120120000 | `supabase/rollback/xp_only_for_answers.sql` | scratch: restores the original definition byte for byte (same hash) |
| Answer persistence | revert the commit; no data is changed | unit tests |
| The gate | nothing to undo (one transaction, always rolled back) | verified |

## Commands

```
C:\Users\USER\dev\codebase\scripts\readiness\run-december-gate.ps1 -Target Preview
C:\Users\USER\dev\fp\run_readonly_sql.ps1 -Target Production -File C:\Users\USER\dev\codebase\supabase\tests\december_data_audit_readonly.sql
C:\Users\USER\dev\fp\apply_xp_only_for_answers.ps1 -Target Preview
C:\Users\USER\dev\fp\apply_xp_only_for_answers.ps1 -Target Production
```

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Product | | | |
| Engineering | | | |
| Curriculum QA | | | |
| Privacy | | | |
| School Operations | | | |
