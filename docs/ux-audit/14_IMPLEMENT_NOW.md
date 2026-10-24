# 14 - Preliminary audit: what to implement now

> **Status, 2026-10-24:** implemented on the local branch (uncommitted, not deployed) and a follow-up the same day finished the three leftovers: UX-023 (migration written, **not yet applied**: `docs/release/APPLY_ATTEMPT_SAVE_LOG.md`), UX-029 (full prefetch on sign-in and sign-up links; the earlier guess about the browser was wrong, the click was waiting for the server) and UX-007 (the guide heading levels are fixed in the renderer, not the guide text). Step 0 was done by the owner. Corrections found while implementing: `/learn` only redirects so it needed no heading; the policy and contact pages needed the `?v=` and `?type=` handling moved (done through middleware and a client component); an extra contrast failure was found and fixed on the pricing gradients (UX-033). Results are in `12_QA_REGRESSION_REPORT.md` section 7.

Written for: the QuizBox owner and whoever edits the code. Every step names the file and the exact change, comes from a finding in `08_PRIORITIZED_DEFECT_REGISTER.csv`, and ends with a check. None of it changes permissions, payments, the database or approval rules. Signed-in behaviour has not been tested in a browser (see 03), so steps marked **verify signed in** need one signed-in look before release.

How to work: make a branch from main (for example `ux/batch-a`), do steps in order, run `npm run typecheck && npm run lint && npx vitest run` after each group, then test on Preview. Do not stage `reports/`, `scripts/question-bank/` or `Questions Bank/`.

---

## Step 0 - Settings only (10 minutes, no code)

**0.1 Canonical address (UX-031).** In Vercel, project `quizbox`, Settings, Environment Variables: add `NEXT_PUBLIC_SITE_URL` = `https://www.quizbox.io` for Production (and Preview if you want previews to match). Redeploy. Check: view source of the home page; `canonical`, `og:url` and `og:image` start with `https://www.quizbox.io`.
(`lib/site.ts` falls back to `https://quizbox.io`, which redirects to `www`.)

---

## Step 1 - Batch A: accessibility and wayfinding (about half a day)

### 1.1 Price chip contrast (UX-001)
`components/pricing/PricingCards.tsx`
- Change `const TONE` to `export const TONE`.
- Schools `ring: "#059669"` becomes `ring: "#047857"`.
- Sponsors `ring: "#ea580c"` becomes `ring: "#c2410c"`.

Add `components/pricing/tones.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TONE } from "./PricingCards";
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
describe("pricing tones", () => {
  for (const [name, t] of Object.entries(TONE)) it(`${name}: ring text on soft background is at least 4.5:1`, () => expect(ratio(t.ring, t.soft)).toBeGreaterThanOrEqual(4.5));
});
```
Check: test passes; `/pricing` axe shows no `color-contrast`.

### 1.2 Page titles for sign-in pages (UX-002)
- `app/login/page.tsx`: add `import type { Metadata } from "next"; export const metadata: Metadata = { title: "Sign in | QuizBox" };`
- These pages are client components, so add a tiny `layout.tsx` in each folder:

```tsx
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Forgot password | QuizBox" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
```
| Folder | Title |
|---|---|
| `app/auth/forgot-password` | Forgot password \| QuizBox |
| `app/auth/reset-password` | Reset your password \| QuizBox |
| `app/auth/update-password` | Choose a new password \| QuizBox |
| `app/auth/callback` | Signing you in \| QuizBox |
| `app/onboarding` | Set up your account \| QuizBox |

Check: each address shows its own tab title.

### 1.3 Signed-in page titles and skip link (UX-003, UX-004) - verify signed in
`components/AppShell.tsx`
1. Right after the `activeHref` `useMemo` (before `if (!ctx) return`), add:
```tsx
const docTitle = useMemo(() => { const label = nav.find(([href]) => href === activeHref)?.[1]; return label ? `${label} | QuizBox` : "QuizBox"; }, [nav, activeHref]);
useEffect(() => { document.title = docTitle; }, [docTitle]);
```
2. As the first child of `<div className="qb-shell" ...>`: `<a href="#qb-main" className="qb-skip">Skip to main content</a>`.
3. Change `<main className="qb-main">` to `<main className="qb-main" id="qb-main" tabIndex={-1}>`.

`app/globals.css` (next to `.qb-sr-only`):
```css
.qb-skip { position: absolute; left: 16px; top: -56px; z-index: 100; background: var(--ink); color: #fff; padding: 10px 14px; border-radius: 8px; font-weight: 700; text-decoration: none; }
.qb-skip:focus { top: 12px; }
.qb-main:focus { outline: none; }
```
Check (each role): the tab title changes on every menu click; first Tab on any signed-in page shows "Skip to main content"; Enter moves focus to the content.

### 1.4 A 404 page with a way out (UX-021)
Create `app/not-found.tsx`:
```tsx
import "./(public)/public.css";
import Link from "next/link";
import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";

export const metadata: Metadata = { title: "Page not found | QuizBox" };
export default function NotFound() {
  return (
    <div className="qbp">
      <PublicShell>
        <section className="qbp-wrap qbp-page-head" style={{ paddingBottom: 64 }}>
          <h1 className="qbp-h2">We could not find that page</h1>
          <p className="qbp-lead">The link may be old or mistyped. Try one of these:</p>
          <ul>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/login?mode=register&role=student">Start practising, free</Link></li>
            <li><Link href="/challenges">Challenges</Link></li>
            <li><Link href="/help">Help</Link></li>
            <li><Link href="/contact">Contact us</Link></li>
          </ul>
        </section>
      </PublicShell>
    </div>
  );
}
```
Check: `/no-such-page` still returns HTTP 404, shows the header, footer and these links.

### 1.5 A heading on the teacher dashboard (UX-005)
Do **not** change `DashboardHero` for everyone: admin, review, school and sponsor already have their own h1.
- `components/DashboardHero.tsx`: add prop `as?: "h1" | "h2"`; replace `<h2>{title}</h2>` with `const Heading = as ?? "h2"; ... <Heading>{title}</Heading>`.
- `app/globals.css` lines 470 and 709: `.qb-dashboard-hero h2` becomes `.qb-dashboard-hero :is(h1, h2)`.
- `app/(app)/teacher/page.tsx`: `<DashboardHero as="h1" ...`.
- Pages with no heading at all (`/learn`, `/student/attempt/[id]`, `/competition/attempt/[id]`, `/competition/results/[attemptId]`, `/onboarding`): add `<h1 className="qb-sr-only">...</h1>` naming the page (for example "Practice question 3 of 10" is too noisy; use "Practice session").

Check: each signed-in page has exactly one h1 (axe rule `page-has-heading-one`, and no second h1).

### 1.6 Link spacing in help guides and Terms (UX-006, UX-007)
The failing links are the "related guides" list and inline links in `components/help/HelpArticleView.tsx` and the contents list on the policy pages. In `app/(public)/public.css` add:
```css
.qbp-prose li a, .qbp-prose p a { display: inline-block; padding-block: 3px; }
.qbp-prose li { margin-block: 4px; }
```
Check: re-run the sweep on `/terms` and the nine guides listed in 07; axe `target-size` must be clean. If it is not, give those links `min-height: 24px`. For the heading-order warning on `getting-started-learner` (the guide jumps a level at "your first steps"), edit the guide text in Admin, Help guides so headings go ## then ###.

### 1.7 Quiz resumes at the first unanswered question (UX-012) - verify signed in
`app/(app)/student/attempt/[id]/page.tsx`, after `setAnswers(saved);` add:
```ts
const firstOpen = payload.questions.findIndex((q) => saved[q.question_id] === undefined);
setIndex(firstOpen === -1 ? Math.max(0, payload.questions.length - 1) : firstOpen);
```
Check: answer 3 of 6, reload; the page opens on question 4.

---

## Step 2 - Batch B: weak networks and recovery (about one day)

### 2.1 Say when the connection drops (UX-022, part 2) - verify signed in
Part 1 (plain offline wording in `lib/errors.ts`, with tests) is already written on the audit branch. Add `components/ConnectionBanner.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

export default function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  const [back, setBack] = useState(false);
  useEffect(() => {
    setOnline(navigator.onLine);
    const off = () => { setOnline(false); setBack(false); };
    const on = () => { setOnline(true); setBack(true); window.setTimeout(() => setBack(false), 3000); };
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, []);
  if (online && !back) return null;
  return <div role="status" aria-live="polite" className={`qb-conn ${online ? "back" : "off"}`}>{online ? "You are back online." : "You are offline. Check your connection; recent changes may not be saved."}</div>;
}
```
Render `<ConnectionBanner />` in `AppShell` directly under `</header>`. CSS:
```css
.qb-conn { position: sticky; top: 0; z-index: 40; padding: 10px 16px; font-weight: 600; text-align: center; }
.qb-conn.off { background: var(--amber-tint); color: var(--amber-text); border-bottom: 1px solid var(--amber-line); }
.qb-conn.back { background: var(--green-tint); color: var(--green); border-bottom: 1px solid var(--green-line); }
```
Check: in dev tools set Network to Offline: the amber banner appears within a second; back online: green banner for 3 seconds.

### 2.2 A failed load keeps the page and offers Try again (UX-014)
Create `components/LoadError.tsx`:
```tsx
import Link from "next/link";
export default function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="qb-card qb-error" role="alert">
      <p>{message}</p>
      <div className="qb-actions">
        {onRetry && <button type="button" className="qb-btn" onClick={onRetry}>Try again</button>}
        <Link className="qb-btn secondary" href="/support/new">Contact support</Link>
      </div>
    </div>
  );
}
```
Use it in place of `if (error) return <div className="qb-card qb-error">{error}</div>` in `/teacher`, `/sponsor`, `/admin/support`, `/admin/competitions`, `/teacher/submissions/[attemptId]`. On `/teacher`, move the loading code into a `load()` function so `onRetry` can call it, and change `Promise.all` to `Promise.allSettled` so one failed analytics call still shows the rest of the dashboard.
Check: block one request in dev tools; the dashboard still shows, with a Try again button.

### 2.3 Answers are never lost (UX-011, UX-023) - **needs your approval first**
This touches how quiz answers are saved, so reproduce it on Preview before changing it: set the network to Offline, answer question 2, go back online, answer 3 to 5, submit, and compare the result to your choices.
Design, if it reproduces, in `app/(app)/student/attempt/[id]/page.tsx`:
1. Replace the chained `pendingSave` promise with a `Map<questionId, answer>` of unsaved answers and a `savedIds` set.
2. A `flush()` function saves every unsaved answer; call it after each answer, on the browser `online` event, every 5 seconds while anything is unsaved, and before submit. Retry with a growing delay.
3. Show a small state beside each question number: Saved, Saving, Not saved (tap to retry). Clear the red banner when `unsaved.size` becomes 0.
4. `submit()` refuses until `flush()` succeeds; if the connection is down it says "Reconnect to submit; your answers are kept."
5. In `lib/api/assessment.ts` call `recordFailure("ATTEMPT_SAVE", error)` inside `saveResponse` (error code only).
Tests: unit-test the queue (fail then succeed; fail twice; submit while pending). The database function `qb_save_response` replaces an answer for the same question, so retrying is safe.

---

## Step 3 - Batch E: one button, one feel (about one day)

### 3.1 Same main button on every screen (UX-025)
- `app/globals.css` line 962: delete the gradient rule `.qb-auth-v2 .qb-btn:not(.secondary):not(.ghost) { background: linear-gradient(...) ... }` (keep line 963 or rewrite to the plain hover), so sign-in uses the solid blue like the rest.
- Make the sign-in primary 44 px and 10 px radius: `.qb-auth-v2 .qb-btn { min-height: 44px; border-radius: 10px; }`. Tab buttons "Sign in / Create account" to 44 px.
- Pricing: keep the coloured section bands, but use the solid primary button for card actions.

### 3.2 Feedback on press and hover (UX-026)
Add to `app/globals.css`, and the same two class names to `app/(public)/public.css`:
```css
:root { --dur-press: 120ms; --dur-enter: 200ms; --ease-out: cubic-bezier(.2, 0, 0, 1); }
.qb-btn, .qbp-btn, .qbp-btn2 { transition: background-color var(--dur-press) var(--ease-out), border-color var(--dur-press) var(--ease-out), box-shadow var(--dur-press) var(--ease-out), transform var(--dur-press) var(--ease-out); }
.qb-btn:active:not(:disabled), .qbp-btn:active, .qbp-btn2:active { transform: translateY(1px) scale(.99); }
@media (prefers-reduced-motion: reduce) { .qb-btn:active:not(:disabled), .qbp-btn:active, .qbp-btn2:active { transform: none; } }
```
Check: a style probe shows a non-zero transition on every button type; with reduced motion on, nothing moves.

---

## Step 4 - Speed (investigate, then change)

### 4.1 Make the public pages cacheable (UX-030)
Cause found, per page:
- **Home** (`app/(public)/page.tsx`) reads `searchParams` (email-link handoff) and `cookies()` (session handoff). Move both into `middleware.ts` (redirect when `hasAuthLinkParams`, hand off when a session cookie exists), then drop them from the page so it can be static with `export const revalidate = 300`. The data it loads is already cached for 5 minutes.
- **Contact** reads `?type=` on the server: read it in a small client component with `useSearchParams` inside `<Suspense>`.
- **Terms and the other policy pages** read `?v=` (version preview): do the same, or only honour it when an admin preview cookie exists.
- **Help guides** set `revalidate = 60` but still answered no-store; find the dynamic call (add `generateStaticParams` first).
Check: `curl -I` shows `x-vercel-cache: HIT` or `STALE` on those pages; median response under 300 ms.
Test on Preview with a signed-in and a signed-out browser: the header must still show the right state.

### 4.2 Faster step to sign-in (UX-029)
`/login` is dynamic (it reads `searchParams`), so the link prefetch is only partial and the click took about 700 ms. Read the registration parameters on the client (`useSearchParams`) so the route can be static and fully prefetched. Check: header Sign in click to heading under 300 ms.

### 4.3 Share previews (UX-032)
Add `app/opengraph-image.tsx` (1200 x 630, logo, tagline) and the same for `challenges/[slug]` and `competitions/[slug]` (title and organiser, no private content). Check in the Facebook Sharing Debugger and by sending the link to yourself on WhatsApp.

---

## Verification (run after every group)

1. `npm run typecheck && npm run lint && npx vitest run` all green.
2. `docs/ux-audit/tools/sweep.js` on the public pages: axe clean on `/pricing`, `/terms` and the nine guides; titles distinct; no overflow; 404 has links.
3. On Preview, for each role: sign in, move through the menu (tab title changes), Tab once (skip link), offline and online (banner).
4. Compare before and after screenshots at 390 px and 1440 px (`evidence/` folder is the "before").
5. Update `12_QA_REGRESSION_REPORT.md` and mark each register item FIXED only when its check passed; otherwise UNVERIFIED.

## What this does not cover

Everything that depends on the signed-in screens: admin menu simplification (UX-017), challenge labels (UX-019), the Help and Support menu merge (UX-018), shared identity loading (UX-013) and the full per-role walkthroughs. Those need the signed-in audit first, with user tests for the layout questions.
