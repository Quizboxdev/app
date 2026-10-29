# 10 - Implementation roadmap

Ordered by severity, reach, frequency, effort and confidence. Every batch is its own branch and reviewable change set, never merged or deployed automatically. IDs refer to `08_PRIORITIZED_DEFECT_REGISTER.csv`.

## Done in this audit

| Change | Files | Tests | Status |
|---|---|---|---|
| **UX-022, part 1:** a lost connection now reads "You seem to be offline, or the connection dropped. Check your connection and try again." instead of the generic server-fault sentence. Known error codes still win; a database "statement timeout" is still reported as a server problem. | `lib/errors.ts` (new `isNetworkFailure`, `NETWORK_ERROR_MESSAGE`) | `lib/errors.test.ts` (4 tests); full suite re-run, see 12 | Unit-tested. **UNVERIFIED in a browser** (needs a signed-in session). The shell banner and retry (part 2) are not built. |

## Update after the implementation pass

Batches A, B (except database logging) and E and the caching, canonical and share-card items are now written on the local branch; see the register status column and `12` section 7 for what is verified. Remaining before release: sign-in checks on Preview for the signed-in items, the offline quiz scenario (UX-011), a deployed-Preview sweep for help guides, policy versions and a real challenge share card, then commit and review. Still open: UX-007, 013, 020, 023, 029, the admin and navigation items (UX-017 to 019), and UX-024.

## Batch A - accessibility quick wins (P2, low risk, about one day)

UX-001 contrast tones (+ contrast unit test), UX-002 auth page titles, UX-003 signed-in `document.title`, UX-004 skip link, UX-005 h1 on dashboards, UX-006 target spacing, UX-007 help heading order, UX-021 branded 404.
Verification before merge: public pages by `docs/ux-audit/tools/sweep.js` (axe clean on `/pricing`, `/terms`, `/help/*`), signed-in items on Preview for each role (title changes, skip link, one h1).

Draft PR description:
> **Accessibility quick wins (WCAG 2.2 AA)** - Fixes the failures found in the product-experience audit: sponsor price chips below 4.5:1 contrast, missing/empty page titles on sign-in pages and across the signed-in app, no skip link in the signed-in shell, dashboards without an h1, a 404 page with no links, and two small link targets. No behaviour, permission or data changes. Tests: contrast test over the pricing tones, title/skip-link component tests. Evidence: axe before/after on `/pricing`, `/terms`, `/help/getting-started-learner`; Playwright keyboard run per role on Preview.

## Batch B - resilience for weak networks (P1/P2, needs approval and a Preview session)

| Order | ID | Work | Approval needed |
|---|---|---|---|
| 1 | UX-011 + UX-023 | Answer save queue: retry with backoff and on reconnect, per-question save state, banner clears on success, submit waits for all saves, failures logged. First **reproduce** with the Preview offline scenario. | Yes: touches assessment integrity |
| 2 | UX-022 part 2 | `useOnline()`, shell connection banner, Try again on failed loads | No |
| 3 | UX-014 | `LoadError` and `Promise.allSettled` on the teacher dashboard and four other pages | No |
| 4 | UX-012 | Resume at first unanswered question | No |

Draft PR description:
> **Don't lose answers on a weak connection** - Retries failed answer saves, shows per-question save state, clears the warning once saving works, waits for all saves before submit, and logs failures to operations. Adds an offline banner and a Try again button on full-page errors. Reproduction test: Playwright offline-then-online scenario on Preview (fails before, passes after). No database changes; relies on the existing idempotent `qb_save_response`.

## Batch C - performance and entry (P2)

1. UX-020: switch `QB_SERVER_GUARD=on` on Preview, repeat the signed-out redirect test (expect one hop), then production. Plan already in `docs/release/SERVER_GUARD.md`.
2. UX-013: measure first (network trace of `/teacher` and `/student`), then share the shell identity through context. Needs the Preview session.
3. UX-016: render the menu once.

## Batch D - information architecture and content (validate with people first)

UX-017 admin home and collapsible menu; UX-018 help/support merge; UX-019 challenge labels; UX-008, 009, 010 public page density and statistics order. Each starts with a 30-minute test: 3 admins (task times), 5 learners (label test), 5 visitors (first-screen interview). Do not build before the result.

## Batch E - design system, buttons and motion (P2/P3; added in the second pass)

Goal: the same primary button, corners, colours and feedback on every screen, and an interface that responds within 100 ms. Standard in `09` section 8.

| Order | ID | Work | Check |
|---|---|---|---|
| 1 | UX-025 | One button system (44 px, 10 px radius, solid blue primary) used on public, sign-in and app screens; gradients only for banners | Computed-style probe identical across pages |
| 2 | UX-026 | Motion tokens and hover/press/focus states; skeletons for loading; progress bar on slow route changes; reduced motion respected | Probe for transitions on every button variant |
| 3 | UX-027 | Radius and breakpoint tokens, lint rule against raw hex; migrate screen by screen | At most 5 radii and 4 breakpoints |
| 4 | UX-028 | Measure rendered font sizes; lift small text on phones | No readable text under 12 px |
| 5 | UX-029 | Prefetch the sign-in route and its form | Median under 300 ms |

Draft PR description:
> **One button system and motion tokens** - Defines button variants and motion tokens in the design-system CSS and applies them to the public pages, the sign-in screen and the signed-in shell, so the main action looks and feels the same everywhere and responds on press. No behaviour changes. Evidence: computed-style probe before/after on `/`, `/login`, `/contact`, `/pricing` and one app page per role; reduced-motion screenshots; axe clean.

Sequence: Batch A (accessibility) first because it touches the same tone and button CSS; Batch E right after, so colour fixes are not redone.

## Standing gate for every batch

Before merge: typecheck, lint and the full test suite; the sweep across public pages; the sweep across each role's routes on Preview; the offline test; a before/after screenshot set at 390 and 1440 px. A change without these is marked UNVERIFIED in 12.

## Not scheduled (missing capabilities, from the plan files)

School and sponsor payers (Coin plan phase 3), automatic Paystack payouts, a reviewer-facing earnings screen if none exists (confirm when signed in).

## Release sequence

1. **Unblock testing.** The supplied logins were rejected by the Preview database (see 03 section I). Create the same accounts **on the Preview project** (admin with super-admin and finance capabilities, teacher with a class, student, sponsor, plus a reviewer and a school admin) and store them as `KEY=value` lines in `.env.acceptance.local`. The local app can then be started against Preview with `docs/ux-audit/tools/` and each role swept, with no Vercel change needed. Fixing the Vercel Preview environment variables is still needed for hosted Preview builds (security audit fix list, step B). *(Owner action.)*
2. **Batch A** to Preview, verify, merge, production; then **Batch E** (same CSS, so it follows straight after).
3. **Batch B** items 2 to 4, then item 1 after reproduction and approval.
4. **Server guard** on Preview, then production.
5. **Batch C** measurement and shared identity.
6. **Batch D** after user tests.
7. Re-run this audit's sweep and the full test suite after each release; record in 12.
