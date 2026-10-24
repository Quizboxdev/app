# 12 - QA regression report

Date: 2026-10-24. Branch: `ux-audit/2026-10-24-product-experience` (from `8330718`). Nothing committed, pushed or deployed.

## 1. Baseline (before any change)

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, no warnings |
| Tests | `npx vitest run` | 168 files passed, 6 skipped; 1,426 passed, 119 skipped, 0 failed (160 s) |

The 119 skipped tests belong to 6 skipped files (live-database and acceptance suites that need credentials). They are skipped, not passed.

## 2. After the one code change (UX-022 part 1)

Changed: `lib/errors.ts`. Added: `lib/errors.test.ts`.

| Check | Result |
|---|---|
| `npx vitest run lib/errors.test.ts` | 4 passed |
| `npm run typecheck` | exit 0 |
| `npx eslint lib/errors.ts lib/errors.test.ts` | no output (clean) |
| Full suite `npx vitest run` | 169 files passed, 6 skipped; **1,430 passed** (1,426 + 4 new), 119 skipped, 0 failed (169 s) |

The new tests cover: the failed-fetch wording of Chrome, Firefox, Safari and Node (`Failed to fetch`, `NetworkError when attempting to fetch resource.`, `Load failed`, `Network request failed`, `fetch failed`); a browser reporting it is offline; known codes unchanged (including when offline); a database "statement timeout" still reported as a server problem.

## 3. Fix status against the quality gates

A fix is FIXED only when its reproduction passes, behaviour is checked at mobile and desktop sizes, accessibility is checked, and backend behaviour is unchanged. Otherwise it is UNVERIFIED.

| ID | Change | Reproduction test | UI verified (mobile and desktop) | Accessibility checked | Result |
|---|---|---|---|---|---|
| UX-022 part 1 | Offline wording | Unit tests pass | **No** (needs a signed-in session) | n/a (text only) | **UNVERIFIED** (unit-tested). Not "fixed": the banner and retry are not built. |

No other register item has been changed. The remaining 23 are OPEN, with fixes designed in 09 and 10.

## 4. Before / after screenshots and measurements

None exist. The only code change affects error wording shown after a failed request in a signed-in session, which was not available. For the public pages nothing changed, so the sweep in 07 stands as the baseline to re-run after Batch A.

## 5. Regression scenarios to keep (candidate automated suite)

Public (runnable today with `docs/ux-audit/tools/sweep.js`, no login):
1. 17 public pages at 360/390/768/1440: HTTP 200, one h1, no horizontal overflow, CLS under 0.1, zero console errors.
2. axe-core wcag2a/2aa/21aa/22aa: zero violations (today: `/pricing` contrast, `/terms` and `/help/*` target size, one heading order).
3. Page titles distinct and non-empty on every public and auth route.
4. Unknown address returns 404 and contains links.
5. Keyboard: skip link first; focus visible for 14 consecutive Tab presses.
6. Signed-out `/admin`, `/teacher`, `/marketplace` redirect to `/login` in one hop (after the guard is on).

Signed-in (run on Preview per role; BLOCKED until accounts exist):
7. Sign in lands on the right home page for each role; menu matches the capability list in 01.
8. Student: practise to result; offline-then-online answer save; resume.
9. Teacher: class, assignment, submission, weak-indicator drill-down; failed analytics call shows a retry.
10. Owner/finance: export one dataset; Payment checks; refund reverses entitlement.
11. Every signed-in page: one h1, a changing title, skip link, no console errors.

## 6. Second pass (same day, later session)

No code changed. The local app was started against the Preview database (production keys overridden, verified in the built bundles) and each supplied account was tried once through the sign-in form: 7 of 7 rejected (see 03 section I). Public-site measurements were extended (buttons, motion, route-change timing, CSS token scan; see 07 section 7). The test totals above are unchanged: 1,430 passed, 0 failed. Register now has 32 items (a later public-site pass added UX-030 to UX-032 and extended UX-006 to nine help guides).

## 7. Implementation pass (owner asked for everything in 14 to be implemented)

All changes are on the local branch, **uncommitted and not deployed**. Checks run after the changes:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |
| `npx vitest run` | 173 files passed, 6 skipped; **1,458 passed**, 119 skipped, 0 failed (was 1,426 at baseline: +32 tests) |
| `next build` with the Preview settings (production keys overridden) | succeeds. `/`, `/contact`, `/terms`, `/privacy`, `/refunds`, `/cookies`, `/opening` are static with a revalidate time; `/help/[slug]` is SSG; `/policy-version/[slug]` and the share-card routes are dynamic |
| Production build served locally (`next start`), public pages at 390 and 1440 px, axe-core WCAG 2.0 to 2.2 A/AA plus best-practice | **zero violations** on `/`, `/pricing`, `/terms`, `/contact`, `/login`, `/help`, the 404 page and `/auth/forgot-password`; one h1 each; distinct titles; no horizontal scroll |
| Cache headers on the local build | `/` s-maxage 300 HIT; `/contact` 3600; policy pages 300; `/login` still dynamic |
| Middleware behaviour (12 tests plus local requests) | `/?code=...` redirects to `/auth/callback?code=...`; a request with a session cookie is served `/opening`; `/terms?v=2` is served by `/policy-version/terms`; other pages untouched |
| Computed styles | sign-in primary button: solid `rgb(37,99,235)`, 10 px radius, 44 px high, 0.12 s transition; the home page primary button identical |

New unit tests: save queue (7), price tones (6), share-card text (3), middleware (4), offline wording (4, earlier).

### Follow-up the same day (UX-023, UX-029, UX-007)

- **UX-023:** migration `20261047100000_attempt_save_failure_log.sql` and rollback written, plus `docs/release/APPLY_ATTEMPT_SAVE_LOG.md`. **Not applied to any database.** Tests: the database list and the browser list of reportable operations must be identical (4 tests); the existing migration-hygiene rules pass (explicit permissions are stated in the migration).
- **UX-029:** on production the click on Sign in waited 500 to 627 ms for a server fetch of `/login` (4 runs); the page scripts then loaded in under 10 ms. The sign-in and sign-up links now use full prefetch. On the local production build, in 2 of 3 runs the login page was already fetched before the click and the click needed no network request (about 135 ms to a visible form); in the first run after the server started the browser fell back to a full page load (433 ms). Re-measure on the deployed site.
- **UX-007:** the cause was the renderer, which drew every guide's `##` sections as h3. `normalizeHeadings` now makes the smallest heading an h2 (3 tests). The link-spacing rule was widened to the "More in ..." lists. Both need an axe check on a deployed Preview, because guides come from the database.

### What is verified and what is not

| Group | Items | Verification |
|---|---|---|
| Public pages and sign-in | UX-001, 002, 021, 025 (sign-in), 026 (public), 030, 031, 033 | **Verified locally** on a production build. Deploy to a Preview and re-run `tools/sweep.js` against it before release |
| Signed-in shell and pages | UX-003, 004, 005, 012, 014, 022 (banner) | **Unverified**: need a signed-in session (UX-024 is still blocked) |
| Quiz answer saving | UX-011 | Queue logic **unit-tested**; behaviour in the real page **unverified**. Run the offline scenario on Preview first |
| Needs a database to check | help guides (UX-006, UX-030), policy versions, challenge share cards (UX-032) | Not verifiable locally (the Preview service-role key was deliberately replaced by a dummy) |
| Not changed | UX-007 (guide text), UX-013, UX-020, UX-023 (needs a migration), UX-029, 008, 009, 010, 015 to 019, 027, 028 | See the register status column |

## 7b. Production verification (deployment of `0986fdb`, READY on 2026-10-24)

Read-only checks against `https://www.quizbox.io` after the owner pushed the release to `main`:

| Check | Result |
|---|---|
| axe-core (WCAG 2.0 to 2.2 A/AA + best practice) at 390 px on 34 pages: home, pricing, 4 policy pages, contact, sign-in, help, a join page, the 404 page, **all 23 help guides** | **0 violations**, one h1 each, no horizontal scroll |
| Help guide headings | h1, h2, h2 (was h1, h3) |
| Cache | `/`, `/contact`, `/terms`, `/privacy`, `/refunds`, `/cookies`, `/help`, `/pricing`, guides: PRERENDER then HIT |
| Titles | Sign in, Forgot password, Reset your password, Choose a new password, Set up your account, Page not found |
| 404 | HTTP 404, 40 links |
| `/?code=...` | 307 to `/auth/callback?code=...` |
| Request with a session cookie | `/opening` content (Opening QuizBox) |
| `/terms?v=1` | 200, "Terms of Use" (served through the policy-version page) |
| Canonical and share image | `https://www.quizbox.io`; `/opengraph-image-...` PNG 41 KB; Twitter large-image card |
| Click on Sign in to a visible form | 102, 123, 144, 234 ms; no request after the click (was 592 to 725 ms) |

Still **not** verified on production (need a signed-in session): page titles and skip link in the app, the offline banner, the quiz save queue, resume at the first unanswered question, the LoadError panel, and a real public challenge share card. The Vercel Preview deployment of the release branch ended in ERROR (the known Preview environment-variable problem); the production deployment of the same commit built successfully.

## 7c. Diligence-readiness pass (2026-10-25)

Repository hygiene and typing, local and uncommitted at the time of writing: Dependabot, `CODEOWNERS`, pull-request template, `SECURITY.md`, `LICENSE` (default proprietary notice, lawyer to confirm), `CONTRIBUTING.md`, a rewritten `README.md`, a complete `.env.example` (the old default pointed at the Production project), a monthly checklist workflow, a database-fingerprint comparison tool with history (`docs/release/FINGERPRINT_HISTORY.md`), a CSP log triage tool and the environment switch `QB_CSP_MODE` (still report-only), `docs/DILIGENCE_OVERVIEW.md`, and typed API layers for the teacher, student, sponsor, competition and practise screens (`any` in application code: 250 to 193; the five largest screens have none). Checks: `tsc` clean, `eslint` clean, **1,479 tests passed**, 0 failed (was 1,464). No behaviour was intended to change; the typing exposed and fixed two latent cases (a weak indicator without class ids could be opened; an assignment without an assessment id was started with an undefined id).

## 8. Known gaps in this QA pass

- No signed-in browser testing of any kind (UX-024).
- No repeated or throttled performance runs; INP not measured; no screen-reader testing; no real-device testing.
- Lighthouse and Chrome DevTools MCP were not available.
