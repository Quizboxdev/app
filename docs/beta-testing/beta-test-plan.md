# Beta test plan

**Goal:** confirm the main journeys work for each role, find confusing wording and layout, and check that people cannot see or change what is not theirs, before any public sign-up.

**Environment:** Preview site and Preview database, test accounts only (`tester-account-matrix.md`). Paystack in TEST mode. Not production.

**Entry criteria:** audit findings QB-AUD-001 fixed on the Preview build; QB-AUD-002 understood (Preview pricing page shows the ladder); Preview seeded with at least one class, one public challenge and one two-round competition; a small test question set approved.

**Method:** 35 scripted scenarios (`test-scenarios.md`, 25 high risk), run by interns in pairs by role; results in `test-case-register.csv`; defects with `defect-report-template.md`; daily report; regression checklist after every fix; exit checklist at the end.

**Schedule (suggested):** Day 1 set-up and AUTH/STU; Day 2 TCH, CHL; Day 3 SPN, ADM, PAY; Day 4 SEC, UX, DATA; Day 5 retest and sign-off.

**Roles:** Beta lead (owns accounts, triage, sign-off); testers (run scripts, report); developer (fix, never alters test results).

**Exit:** `beta-exit-checklist.md` fully ticked. Coverage by role and device is in `beta-coverage-matrix.md`.
