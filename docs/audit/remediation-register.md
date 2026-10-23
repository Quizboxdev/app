# Remediation register

**Status at 2026-10-23.** Items 1 to 3 are done (live site data fixed, Challenges link fixed, repository history cleaned). Items 6 and 7 are in progress (CSP reports and CI added). The rest are open. See `audit-findings.csv` for each finding's current status.

Order of work, with who acts. "Safe fix" means small, tested and applied on the audit branch; nothing here is deployed.

| Order | Finding | Action | Owner | State |
|---|---|---|---|---|
| 1 | QB-AUD-002 pricing page and challenge list not showing live data | Find which Vercel project (quizbox or quizbox-app) owns www.quizbox.io (Settings, Domains); add the variables it is missing (service-role key, CRON_SECRET, VAPID_*, or PAYSTACK/RESEND/EMAIL_FROM); redeploy; later keep one project only, then read function logs for lines starting `[pricing]` or `[challenges]` | Owner | OPEN (logging added) |
| 2 | QB-AUD-001 Challenges link bounces users | Deploy the one-line allow-list fix with its test | Owner approves, then Claude Code | Fixed on branch |
| 3 | QB-AUD-003 wrong files in `main` | Approve force-with-lease of clean commit `432dded` on `main` and the release branch, then add `Questions Bank/`, `scratch/`, `_work/`, `Images/` to `.gitignore` | Owner | Awaiting decision |
| 4 | QB-AUD-010 | Withdrawn (false positive): the French question is correct. No action. | - | WITHDRAWN |
| 5 | QB-AUD-017 / QB-AUD-011 data load hygiene | Run the balancer before approving batches; key SHS indicators by subject | Claude Code with owner | OPEN |
| 6 | QB-AUD-004 CSP | Review reports, switch `CSP_MODE` to `enforce` | Claude Code | OPEN |
| 7 | QB-AUD-005 CI | Add GitHub Actions: typecheck, lint, tests, build on every PR | Claude Code | OPEN |
| 8 | QB-AUD-006 server-side route guard | Proposal (architectural, needs approval) | Owner decision | OPEN |
| 9 | QB-AUD-007, 008, 014 hardening | Rate limit view counter; constant-time ops secret; docx size guard | Claude Code | OPEN |
| 10 | QB-AUD-009, 012, 013, 015 | Dev dependency upgrades, remaining silent catches, doc wording, lint warning | Claude Code | OPEN |
