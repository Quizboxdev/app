# QuizBox: remaining work (as of 2026-10-13)

Companion to `CODEX_QUESTION_GENERATION_HANDOVER.md`. Status words: DEPLOYED = live on main; BUILT = in the repo, not live; OPEN = not built.
Production `main` = `cb5d439`. Tests 908 pass, build compiles.

## A. Owner actions (nothing to build; they unblock everything else)
| # | Action | Blocks |
|---|---|---|
| 1 | Activate GH-SHS-2023 if not yet (4,686 nodes; 32 sources attached). Clear C-20: register Agricultural Science and PE&H Core again with the correct PDFs | SHS question loading for those two subjects |
| 2 | Enter reviewer fees, sample rate and minimum review time (`config/reviewer-policy.json`, Compensation screen); set status APPROVED | Reviewer pay (D-11) |
| 3 | Grant reviewer domains (Reviewers > Domains, now dropdowns) and workload policies; onboard reviewers (coverage was 0) | SME review of the 100 Social Studies + 100 Computing pilot questions |
| 4 | Load the Primary English/Ghanaian/Creative Arts content later through `/admin/question-loading` as batches arrive | Learner content |
| 5 | Decide: lower-primary B1-B3 in scope? Creative Arts etc. subject lists in the Ghana market config (C-18) | Onboarding subject choices |
| 6 | Record hand-applied migrations in the production history; backup/restore evidence | Release gates C3-C5 |

## B. Built but unverified
- Learner "Build your own practice" (`qb_practice_menu`, `qb_start_quick_practice`): the owner reported it working; keep a learner UAT in the acceptance suite (G1/A10).
- Public front-page figures: working per the owner; no minimum-display threshold for small counts yet (decide).
- Reviewer policy page `/review/policy`: file-driven; enforcement is still the existing workload/compensation settings.

## C. Open features (tracker ids)
**Question pipeline**: L6 route every loaded question to the SME pool and close a batch per decision; L7 provenance labels; L9 one clean subject/grade list for question files, teacher and learner pickers; L12 curriculum gaps C-2..C-10 (SHS Additional Mathematics SHS2/3, Arabic, French SHS3, Physics SHS3, Literature SHS2, JHS PE&H B7, JHS Arabic, SHS core Mathematics); history/PE-style source rows for any subject without one.
**Reviewer operations**: R4 sponsor-reviewer tag; R5 compensation plan screen; R6 earnings and daily/weekly tracking; R7 senior QA sampling, minimum review time, seeded items; R8 payout batches.
**Learner and teacher**: T4 topic study mode; T5 concept-level understanding (D-13); T6 teacher view of topic coverage and understanding; G8 teacher-managed accounts for under-13s; A10/G1 verified learner journey.
**Sponsors**: S1 request form; S2 admin queue; S3 sponsor-scope loading; S4 pool verification; S5 competition from a verified pool; S6 notifications; S7 sign-off and publish. (F8: sponsor self-service stays off.)
**Competition**: F3 browser acceptance on Preview; F5 aggregate analytics; F6 leaderboard display names for minors; F7 balanced publication and oversight UI.
**Quality and release**: A5 server-side easy-password check; A7 credential-rotation gate; C1/C2 pooler credentials and pending production migrations; C4 schema parity; C6 grants hardening (TRUNCATE, anon); C7 replayable migration chain; C9 all P0 gates PASS; G2 live acceptance green on Preview; G3 server-side pagination of teacher analytics; G4 media upload end to end; G5 phone-width visuals; G6 mutation/role matrix and cross-tenant tests; G7 one-school pilot, 2-4 weeks; G9 error monitoring and incident runbook.
**Extension (after core gates)**: X0 reconnaissance docs; X1 design-system components; X2 composable roles; X3 campaign domain; X4 public Challenges; X5 participant flows; X6 Campaign Studio; X7 governance; X8 education bridge; X10 vertical templates; X11 analytics taxonomy. X9, X12 deferred.
**AI generation (deferred by decision)**: E1b, E2, E4, E5, E6 behind the admin-only loader; chat-drafted batches are the current route (D-8).

## D. Question bank (the big job; owner chose Codex for it)
Targets at 50 per indicator: Primary 91,250 (1,825 indicators), JHS 65,100 (1,302), SHS about 129,250 (2,585). Delivered so far: 100 (Social Studies B7) + 100 (Computing B4) loaded in review; 100 JHS pilot batches repaired. Everything else is Codex's queue.

## E. Suggested order
1. Owner actions A1-A3 (a day of admin work).
2. Codex: queue extension, generation with audit tooling, curriculum gap extraction.
3. Reviewer operations R4-R8 and L6/L7 (so loaded questions reach reviewers and pay works).
4. Learner/teacher T4-T6, G8; release gates C-track and G2-G6.
5. Sponsor process S1-S7; pilot G7; then the extension X-track.

## F. SHS extraction gaps (measured 2026-10-13)
About 285 indicators missing: core Mathematics 69, Additional Mathematics 60, Arabic 44, French 35, Government 35 (inspect, code forms differ), Physics 30, Literature 4, Agriculture 4, Performing Arts 3, General Science 1. Detail and method: Codex handover, section before 4.
