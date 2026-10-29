# 07 - Accessibility and performance report

## 1. Test environment (state this with every number)

| Item | Value |
|---|---|
| Target | Production `https://www.quizbox.io`, public and signed-out pages only, read-only |
| Browser | Chrome 155 driven by Playwright MCP, Windows 11, desktop machine, ordinary broadband, **no throttling** unless stated |
| Widths | 360, 390, 768, 1440 px (heights 800 / 800 / 900 / 900) |
| Runs | One run per page per width. No repeats, so the figures below are samples, not averages |
| Accessibility tooling | axe-core 4.10.0 injected from cdnjs, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice, at 390 and 1440 px |
| Not available | Lighthouse (not installed), Chrome DevTools MCP (not connected), a screen reader (NVDA/TalkBack/VoiceOver), real Android devices |
| Script | `docs/ux-audit/tools/sweep.js` (re-runnable) |

**Automated tools find only part of WCAG.** A clean axe result below does not mean a page conforms.

## 2. Pages tested: 17 public/auth pages x 4 widths = 68 loads

Every page returned HTTP 200, had `lang="en"`, a viewport meta (zoom allowed), exactly one `<h1>`, a `<main>`, 16 px body text, **no horizontal overflow at any width, layout shift (CLS) 0.0000, 0 console errors, 0 images without alt text.** Aborted `_rsc` requests are Next.js link prefetches and are ignored.

| Page | LCP range across widths (ms) | axe-core result (390 and 1440 px) |
|---|---|---|
| `/` | 1020-1448 (1440 px: not recorded) | none |
| `/pricing` | 880-1892 | **color-contrast, serious, 7 nodes** (UX-001) |
| `/challenges` | 476-1512 | none |
| `/competitions` | 948-1564 | none |
| `/help` | 788-1508 | none |
| `/help/getting-started-learner` | 980-1856 | **target-size, serious, 2 nodes**; heading-order, moderate, 1 node (UX-006, UX-007) |
| `/contact` | 1056-2436 | none |
| `/login` | 764-1852 | none |
| `/auth/forgot-password` | 444-1396 | none |
| `/join/sponsor` | 1076-2272 | none |
| `/join/school` | 1196-1968 | none |
| `/join/sme` | 1044-1612 | none |
| `/join/country` | 760-1268 | none |
| `/terms` | 1248-2624 | **target-size, serious, 2 nodes** at 390 px (UX-006) |
| `/privacy` | 932-2068 | none |
| `/refunds` | 1124-2772 | none |
| `/cookies` | 812-1192 | none |

LCP target is 2.5 s. Two single samples exceeded it (`/terms` 2,624 ms at 768 px, `/refunds` 2,772 ms at 360 px); the same pages measured 1.2-2.3 s in other runs, so this is noise or a first-visit effect, not a proven problem. A repeat with at least five runs per page and CPU/network throttling is needed before anyone calls it a regression. **INP was not measured** (no interactions were scripted); the cumulative-layout-shift goal of 0.1 was met on every page tested.

## 3. Cold-load weight (one measurement)

Home page, caches and service worker cleared, unthrottled: 29 requests, 389 KB transferred, about 1.0 MB after decompression, about 200 KB JavaScript, first contentful paint 2.8 s in that run, load event 3.0 s. The later "Fast 3G" and "Slow 3G" runs are **not reported**: the browser reused cached scripts between runs (JavaScript transfer read 0 KB), so those timings do not represent a first visit on a slow connection. A proper slow-network test needs a fresh browser profile per run.

## 4. Failed and slow journeys

| Journey | Result |
|---|---|
| Signed-out visit to a protected route | HTTP 200 then client redirect to `/login` after 1.2-2.5 s (UX-020) |
| Unknown address | 404, no links, default framework page (UX-021) |
| Offline after visiting `/pricing` | Page served by the service worker, HTTP 200 (PASS) |
| Dashboard load time, API latency, signed-in navigation latency | **NOT MEASURED** (no session) |

## 5. Manual accessibility checks

| Check | Result | Note |
|---|---|---|
| Keyboard: tab order, focus visibility, `/`, `/login`, `/contact` | PASS | Skip link first on public pages; logical order; every stop showed an outline or box shadow (14 Tab presses on each page) |
| Skip link on signed-in shell | FAIL (code) | None in `AppShell.tsx`; the public shell has one (UX-004) |
| Page titles (WCAG 2.4.2) | FAIL | `/login`, `/auth/forgot-password`, `/onboarding` = "QuizBox"; `/auth/reset-password` = empty; no signed-in page sets one (UX-002, UX-003) |
| Headings (1.3.1, 2.4.6) | Public PASS; signed-in FAIL (code) | Dashboards have `<h2>` only (UX-005) |
| Colour contrast (1.4.3) | FAIL on `/pricing` | Orange `#ea580c` on `#fff7ed` = 3.35:1 at 13 px bold; the green schools tone `#059669` on `#ecfdf5` calculates to about 3.6:1; axe reported nothing there (the text using it is large, where 3:1 applies, or absent), so re-check when small text such as Coins chips is added to that section |
| Target size (2.5.8) | FAIL on two pages | Terms table of contents and help article inline links (UX-006) |
| Form labels (1.3.1, 3.3.2) | PASS | Every visible field on all join/contact/login/onboarding forms has a programmatic label; the contact attachment input is deliberately `hidden` |
| Reflow at 360 px (1.4.10) | PASS | No horizontal overflow on any page |
| Pinch zoom (1.4.4) | PASS | Viewport meta has no `maximum-scale` or `user-scalable=no` |
| Reduced motion (2.3.3 / good practice) | Partial | Two `prefers-reduced-motion` blocks exist in `globals.css`; their coverage was not tested |
| Quiz player (code): timer `role="timer"`, progress `role="progressbar"`, feedback `role="status"`, alert for errors | Good | The submit confirmation is `role="dialog"` without `aria-modal` or focus handling (UX-015, to verify) |
| Screen reader testing | NOT TESTED | |
| Touch targets on Android | NOT TESTED on devices | Measured sizes only: 20-41 links per page under 44 px, mostly inline and footer links; AA requires 24 px |

## 6. Signed-in performance and accessibility

BLOCKED. The sweep script runs unchanged on any signed-in route once a session exists; admin and teacher dashboards and the quiz player should be first.

## 7. Colour, buttons and motion (added in the second pass; public pages, production, read-only)

**Buttons, measured on `/`, `/pricing`, `/login`, `/contact`, `/join/sponsor`, `/help` at 390 px.** No solid-colour button text failed 4.5:1.

| Where | Look | Size |
|---|---|---|
| Public primary (e.g. "Start practising, free", "Send enquiry", "Contact us") | solid `#2563eb`, white text, radius 10 px | 44 px high, full width on phones |
| Public secondary ("For teachers and schools") | white, border, radius 10 px | 44 px |
| Sign-in primary | blue **gradient**, radius 12 px | 48 px |
| Sign-in tabs ("Sign in" / "Create account") | white/grey, radius 9 px | 38 px |
| Pricing audience pills and card buttons | three different gradients (blue-violet, green-teal, amber-red) | sizes not measured |

The first primary button on the home page sits at 342 px from the top of a 844 px phone screen, inside the first screen, which is good. Contact and join forms put the submit button at the end of the form (135 px wide on Contact, 158 px on the sponsor form), the expected place on a phone. The inconsistency is the style, not the position (UX-025).

**Motion.** Public primary buttons report `transition: all 0s`, meaning no hover or press feedback. `app/globals.css` has 7 `transition` rules, 2 `@keyframes` and 2 `prefers-reduced-motion` blocks in 978 lines. There is no `loading.tsx` anywhere, so the only loading state for route changes is the boot screen in the signed-in shell (UX-026).

**Route change speed (one run each, 1440 px, production, public pages).** Click to new heading: Pricing 129 and 84 ms, Challenges 66 ms, Competitions 219 ms, Sign in 705 ms (UX-029). Public navigation is fast because Next.js prefetches links; the sign-in link is the exception.

**Design tokens.** `app/globals.css` defines 147 custom properties from a documented token file (ink, surface, line, blue, green, amber, purple, teal, indigo, red, role accents). Drift: 18 border radii, 10 max-width breakpoints, 56 distinct hex colours across the CSS files, 66 font sizes under 14 px (UX-027, UX-028).

## 8. Help guides, caching, sharing and security headers (third pass; production, read-only, signed out)

**All 23 help guides** were opened at 390 px with axe-core (WCAG 2.0 to 2.2 A and AA tags): every one returns 200, has one h1, a specific title, no sideways scroll, 207 to 412 words. Nine have `target-size` failures (2 nodes each, 4 on "Create a challenge"): getting-started (learner, teacher, school), create-a-class, join-a-challenge-or-competition, create-a-challenge, create-a-competition, share-a-challenge-or-competition, contact-support (UX-006). The content is short and in numbered steps where it describes a procedure, which is good for clarity.

**Caching and server response (one request each, one location, so a pattern and not a benchmark).**

| Page | cache-control | Edge result | Response |
|---|---|---|---|
| `/pricing`, `/help`, `/challenges` | public, max-age=0, must-revalidate | HIT or STALE | 523 to 584 ms |
| `/`, `/terms`, `/contact`, `/login`, `/help/<guide>` | private, no-cache, no-store | MISS | 531 to 1,466 ms |

The home page, the legal pages and the help guides are rendered fresh on every visit (UX-030).

**Sharing and search.** Canonical and Open Graph addresses use `quizbox.io` while the site redirects it (308) to `www.quizbox.io` (UX-031). The share image is the 512 x 512 app icon at 257 KB under a `summary_large_image` card, and there is no JSON-LD (UX-032). `robots.txt` (blocks `/api`, `/admin`, `/login`, app routes), `sitemap.xml` (4.5 KB), a web manifest, a service worker, theme colour and Apple icon are all present. `/favicon.ico` returns 404.

**Security headers on the home page:** HSTS (1 year, subdomains), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, Brotli compression. The Content Security Policy is still **report-only** (known audit item QB-AUD-004).
