# 03 - Role user journeys

**How to read this file.** Every step carries one of these statuses. Nothing is marked passed unless a browser run proved it.

| Status | Meaning |
|---|---|
| PASS | Done in a real browser on production, read-only, evidence file named |
| FINDING | Done in a browser and something was wrong (register ID given) |
| CODE-ONLY | Not run. The behaviour was read in source; the result is a prediction, not a test |
| BLOCKED | Needs a signed-in session. No test credentials were available and the assistant cannot type passwords |
| NOT TESTED | Needs data or a flag that is off (Marketplace, seats) |
| MISSING | The capability does not exist in the product |

Evidence folder: `docs/ux-audit/evidence/public/screenshots/` (4 widths per page: `-360`, `-390`, `-768`, `-1440`; `-fold` = first screen on a 390 px phone). Measurements are summarised in 07; `tools/sweep.js` reproduces them.

---

## A. Student

| # | Step | Status | Evidence / note |
|---|---|---|---|
| A1 | Discover the learning offering (home) | PASS | `home-390-fold.png`. Clear hero, two buttons, one h1. First screen shows "Learners: 0 Primary, 4 JHS, 2 SHS" (UX-008). Page is 9,005 px tall on a phone (UX-009). |
| A2 | Reach pricing | PASS | `pricing-390.png`. Segmented by audience, each card shows Coins and cedis. Contrast failure on sponsor chips (UX-001). |
| A3 | Create an account | BLOCKED | Opening `/login` and the "Create account" tab is PASS (`login-390-fold.png`); submitting would create a real production account, which the safety rules forbid. |
| A4 | Choose country, level, grade | CODE-ONLY | `/onboarding` is one screen: name, country, role, level, grade, subjects, school (all labelled). Teacher/SME applications add more fields to the same screen. |
| A5 | Find subject and topic | BLOCKED | `/practise`, `/learn` |
| A6 | Start a practice assessment | BLOCKED | `/practise` -> `/student/attempt/[id]` |
| A7 | Move between questions | CODE-ONLY | Previous/Next, numbered question dots with `aria-label`, progress bar with `role="progressbar"`. |
| A8 | Save answers on a weak network | FINDING (code) | UX-011: a failed save is shown only as a red banner that is never cleared; earlier failed saves are not retried. Runtime behaviour UNVERIFIED. |
| A9 | Submit and see results | CODE-ONLY | Confirmation panel shows "answered X of Y"; time expiry auto-submits. |
| A10 | Understand answers and explanations | CODE-ONLY | Practice mode shows Correct/Not quite, your answer, correct answer, why, hint after "Check answer". |
| A11 | See mastery and guidance | BLOCKED | `/student/results` |
| A12 | Resume an interrupted attempt | FINDING (code) | Server restores answers and remaining time; the question shown restarts at 1 (UX-012). |
| A13 | Find and enter competitions | BLOCKED | Public `/competitions` loads (PASS) but is a short signed-out pointer page ("Sign in or create an account"). |

## B. Teacher

| # | Step | Status | Evidence / note |
|---|---|---|---|
| B1 | Register | BLOCKED | Same as A3. |
| B2 | Onboarding and class setup | BLOCKED | `/teacher/classes` |
| B3 | Find approved questions | BLOCKED | `/teacher/question-banks` |
| B4 | Create and assign work | BLOCKED | `/teacher/assignments`, `/teacher/assignments/by-topic` |
| B5 | Review participation and submissions | BLOCKED | `/teacher/gradebook`, `/teacher/submissions/[id]` |
| B6 | Class mastery and weak indicators | CODE-ONLY | Dashboard has "Needs your attention", "Class performance", "Weak Indicators" with a drill-down. No page-level h1 (UX-005); a failed analytics call replaces the whole dashboard with a bare error message (no retry) (UX-014). |
| B7 | Take intervention action | CODE-ONLY | Select learners from the drill-down and create remedial work. |

## C. School administration

| # | Step | Status | Note |
|---|---|---|---|
| C1 | Onboard an institution | PASS (public part) | `/join/school` form loads, labelled, one honeypot field. Submitting creates a lead; not submitted. |
| C2 | Manage users, classes, outcomes | BLOCKED | `/school`, `/school/*` (5 pages) |
| C3 | Competition participation | BLOCKED | via `/creator?format=competition` |

## D. Subject matter expert

| # | Step | Status | Note |
|---|---|---|---|
| D1 | Apply | PASS (public part) | `/join/sme` loads; applying also exists inside onboarding. |
| D2 | Review queue, source references, decisions | BLOCKED | `/review`, `/review/policy` |
| D3 | Compensation tracking | BLOCKED | `/admin/compensation` is admin-side; no reviewer-facing earnings screen was found by name (verify when signed in). |

## E. Content operations / admin

All BLOCKED in the browser. Static read: see 05. Existing automated evidence: unit and database tests for question loading, batches, exports (1,426 passing).

## F. Sponsor / competition management

| # | Step | Status | Note |
|---|---|---|---|
| F1 | Express interest | PASS (public part) | `/join/sponsor` loads, 10 fields, labelled; consent checkbox 16 px. |
| F2 | Propose, configure, track, report | BLOCKED | `/sponsor`, `/sponsor/workspace` (sponsor engine flag) |

## G. Platform governance

BLOCKED. Capability-filtered menus and the `qb_admin_*` permission checks are covered by existing tests; roles were not exercised in a browser.

## H. Signed-out and error journeys (production, PASS/FINDING)

| Journey | Result |
|---|---|
| Open `/admin`, `/teacher`, `/marketplace` signed out | HTTP 200, shell with "Loading your workspace..." for 1.2-2.5 s, then redirected to `/login` (UX-020). `/play/<slug>` redirected with `?next=` preserved (PASS). |
| Open a mistyped address | HTTP 404 with the framework default "This page could not be found." and **no links at all** (UX-021, `not-found-390.png`). |
| Keyboard only on `/`, `/login`, `/contact` | PASS: skip link first on public pages, logical order, a visible focus ring on every stop (outline or shadow). |
| Offline after a visit | PASS: a visited page (`/pricing`) loaded offline with HTTP 200 from the service worker. Signed-in pages not tested. |

## I. Second attempt: sign-in with the supplied test accounts (2026-10-24, later session)

The owner supplied logins in `.env.acceptance.local` (1 admin, 3 students, 2 teachers, 1 sponsor). What was done, step by step:

| Step | Result |
|---|---|
| Check which database the file targets | Preview project `fngdtxayfoiffbcbmcum`, not production. PASS |
| Start the app locally (`localhost:3100`) with the production keys in `.env.local` overridden (service role, Paystack and Resend keys replaced by dummies) | PASS. The built JavaScript contains the Preview project reference and not the production one, checked before any sign-in |
| Sign in through the real form at 390 px with each of the 7 accounts (sponsor: both candidate passwords) | **All rejected** with "The email or password is incorrect." |
| Wrong-password feedback (a real UX check) | PASS: the message appears within the form in plain words and does not say which of the two is wrong, which is the right choice for security. (Field retention and focus placement were not checked.) |
| Try the same accounts on production | **Not done, by design.** Signing in on `www.quizbox.io` is outside this audit's safety rules |

Retry after the owner edited the file: the file then held 7 account lines (1 admin, 5 student-type lines, 1 sponsor; the two teacher lines were no longer recognised by the parser, so teachers could not be tried). The app was again verified as Preview-only and every parsed account was tried once more: **7 of 7 rejected** with the same message.

Third attempt (passwords corrected by the owner): the same 7 parsed accounts were tried on the Preview-only local app again and **7 of 7 were rejected**. The owner then asked for production to be used instead. The assistant does not type passwords into the production site, whatever the instruction. As an alternative the production sign-in page was opened in the browser window for the owner to sign in by hand, with read-only inspection afterwards; nobody signed in within 4 minutes, so nothing further was done.

Likely cause: the accounts exist on production only. The Preview database needs the same accounts (see UX-024 and `tools/README.md`). The parsed credentials were deleted after use and the helper servers stopped. Every BLOCKED row above therefore stays BLOCKED.

## What would unblock the remaining journeys

1. Seven accounts that **work on the Preview database** (admin with super-admin and finance capabilities, teacher with at least one class, student, sponsor, plus a reviewer and a school admin if possible). Add them to `.env.acceptance.local` as `KEY=value` lines so the tools can read them without guessing.
2. The Marketplace and seat flags switched on in Preview only.
3. Then run: `prepare_audit_env.py`, `run_audit_dev.py`, `cred_server.js`, `signin.js` for each role, then `sweep.js` with each role's routes. The scripts are in `docs/ux-audit/tools/`.
