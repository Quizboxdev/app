# Executive summary

**Verdict.** Engineering readiness: CONDITIONAL. Supervised beta readiness: CONDITIONAL (disposable test accounts on Preview can start now; real payments and open sign-ups should wait).

**Release identity.** The live site (`www.quizbox.io`) runs the build of commit `05b437f`. The audit branch is `audit/2026-10-21-independent-review`, based on local commit `432dded`.

**What is solid.** 1,186 automated tests pass with no failures; type check and lint are clean; the build is clean. The database is built defensively: row-level security on every table, definer functions with fixed search paths, almost no anonymous access, server-computed prices, signed payment callbacks, rate-limited child-account tools, curriculum-only student quizzes enforced by triggers. No secrets are in the source. No P0 findings.

**What needs attention first.**
1. The live pricing page shows four "Tell me when it opens" placeholders and the public challenge list is empty, although the Coin ladder is configured (QB-AUD-002, P1). The code hid the reason; it now logs it. The most likely cause is a missing or wrong server key in the production Vercel settings. Needs a 2-minute owner check.
2. The sidebar "Challenges" link sent users back to their home page (QB-AUD-001, P1). I introduced this in the last delivery. It is fixed on the audit branch with a test, but not deployed.
3. My last commit pushed 3,884 unrelated working files to `main` (QB-AUD-003, P2). No secrets among them. A clean commit is prepared; replacing the remote history needs your approval.

**What this audit could not do.** Test with signed-in accounts, look at the production or Preview database, read Vercel logs, measure performance. Those are marked BLOCKED or NOT RUN, never PASS. The beta kit in `docs/beta-testing/` turns them into scripts interns can run on Preview.

**Counts.** 16 open findings: 0 P0, 2 P1, 5 P2, 8 P3, 1 informational (access limits). One more was raised and withdrawn as a false positive (QB-AUD-010). Full register: `audit-findings.csv`.

**Update, 2026-10-23.** The three items above were fixed (pricing and checkout live, Challenges link fixed, repository history cleaned). Since then the owner added refund tools, a policy section with acknowledgement, support requests with file upload, a Help centre, a CI workflow and CSP violation reporting. Those additions pass the automated suite (1,290 tests) and the build, but were not part of this independent review; see `release-readiness.md` for the follow-up scope.
