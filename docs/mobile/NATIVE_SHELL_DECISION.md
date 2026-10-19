# Native app shell: decision for the owner

Status: **recommendation, for your approval.** Written 21 October 2026. Nothing here has been built; the web app is unchanged.

## The decision in one line
Keep the installable web app as the main product now, add a small set of upgrades to it, and **wrap the same web app in a thin native shell (Capacitor) for Google Play first**, only once three conditions below are met. Do not rebuild natively.

## Where we are today
- The site is a responsive web app on one Supabase backend. It has a web app manifest (add to home screen, full screen, icons) but **no service worker**, so it needs a connection and does nothing offline.
- Every screen was checked at 360, 390 and 768 pixel widths and the Challenges screens were fixed for phones.
- There is a published list of every database call a client may make (`docs/api/MOBILE_API_CONTRACT.md`, regenerated today and now including Challenges), so a native app could use the same backend unchanged.
- No push notifications exist. In-app notifications do.

## The three options
| | A. Installable web app (PWA) | B. Wrapped web app (Capacitor) | C. Native rebuild (React Native or Flutter) |
|---|---|---|---|
| What it is | The website, installed from the browser | The same website inside a thin Android/iOS shell, listed in the stores | A second app written again for phones |
| New code | Small: service worker, offline notices, push (Android, installed only) | Small to medium: shell, push, deep links, store assets | Very large: every screen rebuilt and kept in step with the web |
| Time to first release | Days | About 2 to 3 weeks including store review | Many months |
| Play Store / App Store presence | No (Android can list a PWA through a trusted web activity; iOS cannot) | Yes | Yes |
| Push notifications | Android yes if installed; iPhone only from iOS 16.4 and only when added to the home screen | Yes on both, reliably | Yes |
| Offline | Shell only, until a safe design exists for answering | Same as A | Full, but costly to get right |
| Cost to keep going | One codebase | One codebase plus store upkeep | Two codebases for ever |
| Risk | Low | Low to medium (store rules, below) | High |

## Recommendation
1. **Now (option A upgrades, a few days):** a service worker that caches the app shell and shows a friendly offline screen (no offline answering yet); web push for installed Android users; an "Install QuizBox" prompt on the Student Home. This costs almost nothing and helps every phone user straight away.
2. **Then (option B, about 2 to 3 weeks):** wrap the web app with Capacitor and publish to **Google Play first**. Most Ghanaian learners are on Android with limited data, and Play listing costs a one-off USD 25. Add the App Store later (USD 99 a year) only if iPhone users appear in your numbers.
3. **Not option C.** Revisit only if there is a feature the web cannot do (heavy offline work, background sync) and the user numbers justify two codebases.

## Conditions before building the wrapped app
These are real blockers, not formalities.
1. **Payments in the stores.** Apple (and Google, for most apps) require their own in-app purchase system for digital subscriptions sold inside an app, with a 15 to 30 percent fee, and they restrict linking out to another payment page. Paystack inside the app would be rejected. Decision needed: sell subscriptions **only on the website** and make the app a "sign in to use" companion (allowed on Google Play in many cases, harder on Apple), or accept store billing. Until you have chosen, ship the app **without** the Subscribe page and show "manage your plan on quizbox.io".
2. **Children.** Google Play's Families policy and Apple's Kids rules apply to apps aimed at under-13s. Our under-13 accounts are created by teachers and carry strict limits, but the store listings, privacy policy and data-safety forms must say exactly that. This needs the counsel review already on your list (`docs/security/UNDER_13_DESIGN.md`).
3. **A privacy policy and account deletion route.** Both stores require a public privacy policy URL and a way to delete an account from inside the app. Erasure exists for young learners; an ordinary account deletion flow still needs building.

## What the wrapped app needs built
- The Capacitor project, app icon and splash from the existing brand files, and store listing text and screenshots.
- Sign-in return links so email confirmation and password reset open the app (Android app links, iOS universal links) using the existing `/auth/callback`.
- Push notifications on Firebase Cloud Messaging, fed by the same notification records the app already writes (assignment due, results ready, prize won, challenge hidden).
- A rule that external links (terms, privacy) open in the browser, and the Subscribe page hidden or replaced as decided above.
- Release checklist: Android signing key held by you, internal test track first, then production.

## What I will do without further input
Option A upgrades are low risk and do not depend on your decisions; I can build them next. Everything in "conditions" waits for you.

## Decisions I need from you
1. Approve the recommendation (A now, B on Google Play first, no C)?
2. Subscriptions: website only for now, or store billing later?
3. Who owns the Google Play developer account (it should be yours, not a contractor's)?
