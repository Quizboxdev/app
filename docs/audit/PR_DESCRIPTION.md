# Independent audit: findings, architecture docs, beta testing kit

Draft pull request for branch `audit/2026-10-21-independent-review`. Title: **Independent audit, architecture documents and beta testing kit**.

## Why
QuizBox is moving from build to beta. This adds an independent, evidence-based review of the platform, written documentation of how it is built, and a ready-to-use testing programme for interns, so the beta is run on facts and not assumptions.

## What is in it (documentation, one script and one docs test; no application behaviour changes)
- `docs/audit/`: executive summary, repository inventory, architecture review, security review, functional and QA report, curriculum data-quality report, performance review (not run), `audit-findings.csv` (17 findings, each with status), remediation register, test coverage matrix, release readiness with quality gates, evidence manifest and the evidence files.
- `docs/architecture/`: system overview, role and permission matrix, API inventory, database relationships, process flows (Mermaid).
- `docs/beta-testing/`: test plan, intern manual, tester account matrix, 34 scenarios (25 high risk), test case register, defect template, daily report, regression checklist, exit checklist.
- `docs/user-guides/`: index and a public getting-started guide with real screenshots of the live public pages.
- `scripts/audit/qb_validate.py`: the question-bank scanner used for the data-quality report.
- `lib/docs/csv-integrity.test.ts`: checks that the findings, coverage and test-case registers are valid CSV (the same number of columns in every row).
- `.gitignore`: question-bank working files are no longer committable by accident.

## Findings
0 P0, 2 P1, 5 P2, 8 P3, 1 informational, 1 withdrawn (a false positive, kept for traceability). Status on 2026-10-23: QB-AUD-001, 002, 003 and 013 are fixed or resolved; 004, 005 and 012 are in progress; the rest are open. Full detail: `docs/audit/audit-findings.csv`.

## Defects addressed by changes already on main
| Finding | Fix | Regression test |
|---|---|---|
| QB-AUD-001 Challenges link bounces users | `/open` added to the route allow-list | `components/appshell-nav.test.ts` |
| QB-AUD-002 live pricing and challenge data missing | environment variables corrected by the owner; failure logging added | `lib/pricing/server.test.ts`, `app/api/payments/checkout/route.test.ts` |
| QB-AUD-004 CSP not enforced | violation reports collected | `lib/security/csp-report.test.ts` |
| QB-AUD-005 no CI | `.github/workflows/ci.yml` | the workflow itself |

## Testing performed
Type check clean; lint 0 errors; 1,290 automated tests pass (119 live-environment tests skipped); production build clean. Browser checks were limited to the public pages of the live site (desktop and phone). Signed-in journeys, live authorization probes, the production database and performance were not testable by the auditor and are marked BLOCKED or NOT RUN, never PASS.

## Risk and rollback
Low: documentation, one script, one docs test and `.gitignore`. Rollback is a revert of the merge.

## Not covered
Features added after the audit (refund tools, policy section, support requests with uploads, Help centre) were not independently reviewed; see the addendum in `docs/audit/release-readiness.md`.

## Reviewer checklist
- [ ] `git diff --stat origin/main...HEAD` shows only documentation, `scripts/audit`, `lib/docs` and `.gitignore`
- [ ] No secrets or personal data in the screenshots or evidence files
- [ ] Findings and statuses in `audit-findings.csv` match what you see in the product
- [ ] The beta scenarios are runnable on Preview with the accounts in `tester-account-matrix.md`
