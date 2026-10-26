# Vercel environment consistency - 26 October 2026

## Contract

QuizBox remains in development/testing. Test Paystack keys are expected in all environments until a separate go-live decision. The Production and Preview labels refer to Vercel scopes, not approval to take live payments.

| Setting | Production scope | Preview scope |
| --- | --- | --- |
| Supabase project | fmgccmqxfjppqydkhaiu | fngdtxayfoiffbcbmcum |
| Public Supabase key | Active anon/publishable key of Production project | Active anon/publishable key of Preview project |
| Server Supabase key | Production service role; server-only | Preview service role; server-only |
| Paystack | Test during development; live requires go-live approval | Test only |
| NEXT_PUBLIC_SITE_URL | https://www.quizbox.io | https://www.quizbox.io (canonical metadata; auth uses visitor origin) |
| Framework | Next.js | Next.js |

Do not copy Production database or service credentials to Preview. Global Preview variables must not be accidentally restricted to one branch. Secret values must remain masked. Existing payment-provider webhook secrets, if used, must agree with the selected provider mode.

## Findings and changes

- `quizbox` pilot deployment `6BbKJn3FwZVucv8mbzjT69Fxk6ip`, SHA `110f284`, failed before compilation: `QuizBox requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.` Both Preview variables existed only for `release/public-homepage-hardening`.
- Preview public URL and key now apply to all Preview branches. The Preview publishable key was compared against active keys returned by Supabase; its project is Preview. A transient empty URL created during the verification prompt was corrected before any deployment.
- Preview service-role secret scope was expanded with the owner's explicit authorization. Its write-only value was preserved, not rotated.
- `NEXT_PUBLIC_URL_SITE` was renamed to the code's `NEXT_PUBLIC_SITE_URL`, preserving the canonical URL and Production/Preview targets.
- Paystack Preview initially displayed a live-key hint. The owner reported replacing test keys and explicitly authorized continuing after the hint discrepancy was reported. The existing Preview-only secret now applies to all Preview branches as approved. The write-only secret value was not changed by the agent; Vercel's displayed hint still read `sk_live_` after refresh, so test-mode validation remains unresolved. No payment was initiated. Production payment configuration was not changed.
- `quizbox-app` and `app` both used the `Other` framework preset. `quizbox-app` showed a successful deployment but `/login` returned `500 MIDDLEWARE_INVOCATION_FAILED`. Runtime logs show raw `middleware.js` ESM executed as CommonJS (`Cannot use import statement outside a module`). Both dashboard presets were changed to Next.js. Repository `vercel.json` now pins the framework and build command, preserving the existing cron.
- With explicit owner approval, the two auxiliary projects' obsolete shared public-variable Secret records were deleted and recreated as separate Production and Preview Config records. Each pair uses the verified public key of its target project. Canonical site URL entries were added for both scopes. No database or provider key was deleted or rotated. Existing deployed builds retained their prior configuration throughout.
- The primary Preview was rebuilt without cache: deployment `Hx7gpf66m7mhoE5jFFmVUgUF5bn6` at SHA `110f284` is Ready. `/login` renders at https://quizbox-8llttf2vs-questioningboxgmailcoms-projects.vercel.app/login with no captured console errors. This verifies the missing-variable build repair and logged-out runtime only.
- Auxiliary Preview rebuilds are being verified; record their final results below. Server-only optional integrations still differ between projects: `quizbox-app` has Preview service role, email and Paystack configuration; `app` initially had only public Supabase keys. No server secrets were copied across projects in this repair.
- The original checkout's `.env.local` targets Production but its `SUPABASE_SERVICE_ROLE_KEY` JWT has role `anon`; it is not a valid service-role configuration. The original local file was not changed. `.env.branch.local` has a matching Preview URL, anon JWT and service-role JWT and passes the static audit.

## Read-only audit

`npm run env:audit -- --target preview --file <ignored-preview-env-file>`

`npm run env:audit -- --target production --payment-mode test --file <ignored-production-env-file>`

Add `--require-operations` to require server/payment/email/cron/push configuration. Without it, absent optional integrations stay disabled. An explicit file is isolated from process environment. Output contains variable names and issue codes only. This is static validation: modern opaque key/project membership, provider authentication, role/RLS behavior and end-to-end payment settlement need separate evidence.

The live-payment audit mode is an explicit option for a future approved go-live, not permission to activate it.

## Verification and release gate

Record each new Preview deployment URL, SHA, framework and `/login` runtime result after rebuilding. Confirm the expected Supabase project and auth callback allowlist without weakening protection. Never promote or redeploy Production as part of this repair. A passing build alone does not clear auth, role/RLS, payment, or content release gates.

Dashboard rollback: restore a saved branch restriction if required; preserve environment-specific values. Repository rollback: revert this configuration/audit PR. No database migration is involved.

Reference: https://vercel.com/docs/project-configuration

## Local check results

- Focused environment/config tests: 26 passed across 3 files.
- Typecheck and lint: passed.
- Production build with harmless CI public settings: passed. No live database was used.
- Full regression suite: final run recorded in ignored `reports/qa/env-full-tests.log`. An isolated rerun on the main-based environment branch reproduces the existing `lib/school/performance-rollback.test.ts:50` failure (2 passed, 1 failed): exact SQL function-definition comparison differs by Windows line endings. No migration or rollback source was changed by this repair.
- The earlier pilot-wide run recorded 1533 passed, 119 skipped, 1 failed. Skipped authenticated/live suites are not acceptance evidence.

## Changed-file inventory

- `vercel.json`: version-controlled Next.js adapter and build command; cron retained.
- `.env.example`: canonical site URL contract and test-payment stage wording.
- `package.json`: `env:audit` command.
- `lib/operations/environment-audit.ts`: static, value-free environment checks.
- `lib/operations/environment-audit.test.ts`: scope/key/payment-mode regressions.
- `lib/operations/deployment-config.test.ts`: adapter/build/cron contract regressions.
- `scripts/audit-environment.ts`: explicit target/file audit CLI.
- This document: findings, changes, evidence and remaining release gates.
