# 04 - UX / UI heuristic audit

Method: Nielsen's ten heuristics applied to (a) the public site and sign-in screens, tested in a real browser at 360, 390, 768 and 1440 px, and (b) the signed-in shell and two high-traffic signed-in screens (student quiz player, teacher dashboard), read in source. Signed-in findings are marked **(code)**: they come from reading the code, have not been reproduced in a running session, and are labelled UNVERIFIED in the register until they are.

Scoring: 0 = broken, 1 = major problems, 2 = adequate with gaps, 3 = good. Scores cover only what was examined.

| # | Heuristic | Public / auth (browser) | Signed-in (code) |
|---|---|---|---|
| 1 | Visibility of system status | 3 | 2 |
| 2 | Match with the real world | 3 | 2 |
| 3 | User control and freedom | 2 | 2 |
| 4 | Consistency and standards | 2 | 2 |
| 5 | Error prevention | 3 | 2 |
| 6 | Recognition over recall | 3 | 2 |
| 7 | Flexibility and efficiency | 2 | 2 |
| 8 | Aesthetic and minimalist design | 2 | 2 |
| 9 | Help users recover from errors | 1 | 1 |
| 10 | Help and documentation | 3 | 2 |

## 1. Visibility of system status

Good (browser): the signed-in boot screen says "Loading your workspace..." with `role="status"`; sign-in has a show/hide password control; the quiz player shows "Question 3 of 10", a progress bar, a countdown, "Saving..." and "Checking..." states **(code)**.

Gaps:
- Signed-out visitors to a protected address (`/admin`, `/teacher`, `/marketplace`) see the app shell loading text for 1.2-2.5 s before being sent to sign-in (UX-020). They are told "Loading your workspace" about a workspace they do not have.
- A failed answer save is shown only as a red banner that is never cleared **(code, UX-011)**: the banner can outlive the problem or be missed.

## 2. Match with the real world

Strengths: plain Ghana-specific wording on the home page ("Primary, JHS and SHS", "B4 to B6"), prices in cedis with Coins shown next to them, "Practise" spelled the British way consistently with the audience. The glossary (`docs/ux/GLOSSARY.md`) is followed on the pricing page.

Risks: a student menu with four competition-related items - "Compete", "Challenges", "My challenges", "Create and share" **(code, UX-019, hypothesis)**. The product does separate challenges (anyone creates, shared by link) from competitions (organised, approved), but a learner may not.

## 3. User control and freedom

- Quiz: Previous/Next and numbered dots allow any order; the submit panel offers "Keep working" **(code)**.
- Sign-in: back link on password reset; "Forgot password?" reachable by keyboard.
- Dead end: the 404 page has **no links** (UX-021, observed).
- Resuming a quiz always starts at question 1 (UX-012, code).

## 4. Consistency and standards

- Two help systems: public `/help` and signed-in `/guides`; "Help" and "Support" sit side by side in the top bar (UX-018, hypothesis).
- Three links to the same page (`/account`): avatar, "Account" button, and the student menu entry (code).
- Page titles: every public content page has a specific title ("Pricing | QuizBox"); `/login`, `/auth/forgot-password` and `/onboarding` are just "QuizBox" and `/auth/reset-password` is empty (UX-002, observed). No signed-in page sets a title (UX-003, code).
- Heading structure: signed-in dashboards use `<h2>` for the page title and the top bar title is a `<strong>`, so many pages have no `<h1>` (UX-005, code).

## 5. Error prevention

Good: required fields marked and labelled in every public form (axe: no label failures); a honeypot field keeps bots out without a CAPTCHA; submit confirmation in the quiz warns "You have answered X of Y"; Marketplace and payments check price on the server.

## 6. Recognition rather than recall

Good: breadcrumbs ("Home / Pricing"), the active page highlighted with `aria-current`, price cards that always show both units. The mobile bottom bar shows four to five main items plus "More".

## 7. Flexibility and efficiency

- Phone: one-handed bottom navigation is a good fit for the audience.
- Admin: 33 admin screens; up to 39 links in the admin menu, 12 in one group (UX-017). No global command palette; `GlobalSearch` exists in the top bar (not examined).
- Repeated identity requests on every page (UX-013) cost time on slow networks.

## 8. Aesthetic and minimalist design

Strong brand consistency (lockup, blue/green/red palette, role colour bands on pricing). Issues:
- The home page is about 10.7 phone screens long (9,005 px at 390 px) and pricing about 9 (7,780 px) (UX-009).
- The home page opens its statistics with "Learners: 0 Primary, 4 JHS, 2 SHS" and "Schools: 0" and only explains "Ghana pilot..." in small print below them (UX-008). Honest, but a first-time visitor reads zeros.
- Pricing: orange sponsor chips fail contrast (UX-001, 3.35:1 against the 4.5:1 minimum).
- The main button changes style between the public pages (solid blue, 10 px radius, 44 px) and the sign-in screen (gradient, 12 px radius, 48 px) (UX-025), and gives no hover or press feedback on public pages (UX-026). Details in 07 section 7; the standard to aim for is in 09 section 8.

## 9. Recover from errors

- **404:** default framework text, no navigation (observed).
- **Dashboard load failure:** the teacher dashboard, sponsor dashboard and three admin pages replace the whole screen with the error message alone and no retry or next step (UX-014, code, 5 pages).
- **Lost connection (UX-022, code):** the shared message table (`lib/errors.ts`) has no entry for a network failure, so a dropped connection becomes "The operation could not be completed. Please try again or contact support." A search of `app/`, `components/` and `lib/` found no use of `navigator.onLine` or the browser `online` event: the app never tells a user they are offline and never retries when the connection returns. This matters most for the primary audience (mobile data in Ghana).
- **Quiz save failure:** see 1.
- `app/error.tsx` and `app/global-error.tsx` exist (not exercised), but there is no `not-found.tsx`, no `(app)/error.tsx` and no `loading.tsx`.

## 10. Help and documentation

Good: public help centre with search, role-specific guides, contextual `HelpStarter` in the signed-in shell, support requests with attachments, a Contact page that routes by intent (`contact-390-fold.png`). Gaps: the contact form is below four routing cards, about 700 px down on a phone (minor); help articles skip a heading level and have two small adjacent links (UX-006/007).

---

## Observations that are not defects

These came out of the automated sweep and are listed so nobody chases them:
- Aborted `_rsc` prefetch requests (`net::ERR_ABORTED`) appear on public pages. They are Next.js link prefetches cancelled when the page changes. Not errors.
- 20-54 links per page measure under 44 px tall. WCAG 2.2 AA requires 24 px with spacing exceptions (2.5.8); 44 px is the stricter AAA guideline (2.5.5). Only two pages produced a 2.5.8 failure (UX-006). Inline text links are exempt.
- Layout shift measured 0 on every public page tested; no horizontal overflow at any of the four widths.
