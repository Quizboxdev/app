# Turning on the Content Security Policy (CSP)

**Status (2026-10-24): report-only.** Browsers tell us what the policy would block; nothing is blocked. The collector (`/api/ops/csp-report`) went in with commit `a6d1385` on 2026-10-23, so the earliest sensible review date is **on or after 2026-10-31** (seven full days of real traffic). The switch is built and tested: it is a Vercel setting, not a code change. It is deliberately **not** switched on, because the rule below needs a week of evidence first.

## Why wait

Enforcing a policy that blocks something QuizBox really uses (an image host, a font, a payment redirect) would break a screen for learners. Report-only shows us that first, at no cost.

## The decision rule

Enforce when all of these are true:
1. At least **7 days** of logs since the collector went live, including **school days** (Monday to Friday during school hours) and at least one payment, one challenge share and one admin export.
2. Every group of `[csp]` lines is explained: it is either fixed (we added the origin to `lib/security/headers.ts`) or it is noise (one visitor's tool or a bot).
3. No `eval` group remains (we do not allow `unsafe-eval`).
4. A Preview deployment with enforcement on has been clicked through (below) with no broken screen.

## Step 1. Collect the log lines (about 5 minutes)

Vercel, project `quizbox`, Logs, environment **Production**, time range **Last 7 days** (or since 2026-10-24), search for `[csp]`. Export or copy the lines into a text file, for example `csp-logs.txt` (outside git: do not commit logs).

## Step 2. Triage them

```powershell
npx tsx scripts/ops/csp-triage.ts csp-logs.txt
```

It prints `CLEAN` (no lines) or `REVIEW` with each group: how many times, which directive, what was blocked, on which pages. Browser-extension reports are already filtered out by the collector.

| Group looks like | Action |
|---|---|
| An origin we use (our storage, a font, Vercel analytics) | Add it to the matching directive in `lib/security/headers.ts`, add a test line, deploy, wait a day, triage again |
| `eval` | A library needs `unsafe-eval`: find it (the page column tells you where) and replace or remove it. Do not allow `unsafe-eval` |
| `inline` for style or script | Already allowed (`'unsafe-inline'`), so this should not appear; if it does, send me the line |
| One odd origin on one page, a few times | Almost always a visitor's browser tool or a bot. Note it and ignore it |

## Step 3. Try enforcement on Preview first

1. Vercel, project `quizbox`, Settings, Environment Variables: add `QB_CSP_MODE` = `enforce` for **Preview** only. Redeploy a branch (the Preview build must be healthy: it is currently failing because of the Preview variables problem; fix that first).
2. Open the Preview URL with the browser developer tools Console open and click through: home, sign in, student practice, a challenge link, pricing, Contact, a Marketplace page, an admin export. **No red "Refused to ..." lines** and no broken screens.
3. If a line appears, fix it as in the table above and repeat.

## Step 4. Enforce on Production

Add `QB_CSP_MODE` = `enforce` for **Production**, redeploy, and watch the logs for an hour: any `[csp]` line now means something was blocked for a real person. Check the same screens on www.quizbox.io.

## Going back (takes two minutes)

Delete the `QB_CSP_MODE` variable (or set it to `report-only`) and redeploy. The headers return to report-only exactly as before. Nothing else depends on it.

## What the code does

`lib/security/headers.ts` reads `QB_CSP_MODE`. Only the exact word `enforce` turns blocking on; anything else, including a typo, keeps the safe mode (tested in `lib/security/headers.test.ts`). In enforce mode the header is `Content-Security-Policy` and `upgrade-insecure-requests` is added; every other directive is identical to the one being reported on now, so what was tested in report-only is what is enforced.
