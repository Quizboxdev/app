# 13 - Executive product experience report

Audit date 2026-10-24 (two passes). Scope: public site, sign-in screens and signed-out behaviour in a real browser; signed-in screens by code reading and the existing test suite. **Signed-in journeys were not run in a browser.** In the second pass the supplied test logins were tried against the Preview database through the real sign-in form and all seven were rejected; they most likely exist only on production, where this audit may not sign in.

## 1. Overall assessment

QuizBox's public experience is in good shape: every page tested loads quickly, fits a 360 px phone without sideways scrolling, has no layout shift, no console errors, labelled forms and a working keyboard path. The product's engineering base is strong (type checks, lint and 1,430 automated tests all pass).

The weakness is **resilience on poor connections and consistency of the signed-in shell**. The primary audience uses mobile data in Ghana, yet the app has no offline awareness, a failed answer save can be silently lost, and a single failed request can blank a whole teacher dashboard. These are fixable with contained changes. The signed-in areas are about four in five of the 110 screens (87) and have not been seen working in a browser by this audit, so overall confidence is **moderate** and the scores below are provisional.

## 2. Scores by role

**Rubric (0 to 3 per criterion, weighted):** task completion 30 %, navigation and information architecture 15 %, error prevention and recovery 15 %, accessibility 15 %, mobile performance 10 %, consistency 10 %, help 5 %. A criterion is scored only where there is evidence (B = browser, C = code). Score = weighted average of the scored criteria; coverage = share of the total weight that had evidence. Roles under 30 % coverage are **not scored**.

| Role | Evidence | Coverage | Score (of 3) | Main reasons |
|---|---|---|---|---|
| Visitor (public site) | B | 100 % | **2.3** | Fast, accessible forms, strong keyboard path; 404 dead end, contrast and title gaps, very long pages |
| Student | C | 60 % | **1.7 provisional** | Good player accessibility and feedback; save failure and offline gaps; no titles, skip link or h1 |
| Teacher | C | 60 % | **1.8 provisional** | Clear dashboard sections; whole-page failure state; no h1 |
| Admin / Owner | C | 60 % | **1.6 provisional** | 33 screens, exports and payment checks are strong; up to 39 menu links; two whole-page error states |
| School admin, Sponsor, SME reviewer | none or public forms only | under 30 % | **Not scored** | Signed-in screens not seen |


Per-criterion scores behind the table (so anyone can recompute; `-` = no evidence, not scored):

| Role | Task 30 | Nav 15 | Errors 15 | A11y 15 | Perf 10 | Consistency 10 | Help 5 |
|---|---|---|---|---|---|---|---|
| Visitor | 2.5 | 2.5 | 1.5 | 2.0 | 2.5 | 2.5 | 3.0 |
| Student | - | 2.0 | 1.0 | 1.5 | - | 2.0 | 2.5 |
| Teacher | - | 2.0 | 1.5 | 1.5 | - | 2.0 | 2.0 |
| Admin / Owner | - | 1.5 | 1.5 | 1.5 | - | 2.0 | 2.0 |

These are judgement scores from the evidence listed in 04 to 07, not measurements. Visitor task completion stops before form submission, which was not done on production.

These numbers rank where to look first. They are not a claim about how users feel; no user was observed.

## 3. Ten highest-impact experience issues

(Later passes added buttons, motion and design-system findings (UX-025 to UX-029) and page caching, canonical address and share-preview findings (UX-030 to UX-032); they rank just below this list. The experience standard that answers the owner's goal, with measurable rules for colour, button placement, motion, recovery and clarity, is `09` section 8.)

1. **No offline or connection handling** anywhere in the app; failures read as server faults (UX-022, P1; wording fixed, banner and retry open).
2. **Answer saves can fail without a retry** and the warning never clears (UX-011, P1, code-verified, needs reproduction).
3. **Signed-in journeys unverified** in a browser (UX-024).
4. **Identity fetched again on 16 pages** on top of the shell: extra round trips on every navigation (UX-013).
5. **One failed request replaces a whole page** with an error line and no retry (UX-014, five pages).
6. **404 page has no links** (UX-021).
7. **Protected pages show the app shell for 1.2 to 2.5 s** before redirecting signed-out visitors (UX-020, server guard built but off).
8. **No page titles** on sign-in pages and the whole signed-in app (UX-002, UX-003).
9. **No skip link and no h1** in the signed-in app (UX-004, UX-005).
10. **Admin menu of up to 39 links** with no task-first home (UX-017); and sponsor price chips failing contrast (UX-001).

## 4. Top recommended interface improvements

Connection banner and Try again on failures; save state per question; one page heading and title per screen; branded 404; task-first admin home; a shorter home page and tabbed pricing; one Help and support menu. Detail in 09.

## 5. Highest-value workflow automation

1. Automatic retry and queue of answer saves (protects results).
2. Daily scheduled Payment checks with a notice to finance only when something needs attention (the scan and settle action exist; the schedule does not).
3. A Playwright sweep per role on Preview in CI (this audit's script is the start) to catch contrast, title, heading and console errors on every release.
4. "Next step" strips on content screens so staff do not need to remember the order of curriculum, loading, approval and quality.
5. Resume-at-first-unanswered for interrupted attempts.

## 6. Implemented fixes and test outcomes (updated after the implementation pass)

Written on the local branch (uncommitted, not deployed): accessible pricing colours, page titles for sign-in pages and the signed-in app, a skip link, headings, a useful 404 page, a retrying answer-save queue with a "not saved yet" state, an offline banner, a shared error panel with Try again, one primary button style with press feedback, cached home, contact and policy pages, a correct canonical address and wide share previews. Checks: type check and lint clean; **1,451 tests passed, 0 failed** (1,426 before); a production build of the public pages is axe-clean at phone and desktop width. The signed-in changes and the quiz save queue are **unverified in a browser** until test accounts work on Preview. Details: `12` section 7.

(Earlier summary of the first change:)

One change: plain "you seem to be offline" wording for dropped connections (`lib/errors.ts`, 4 new tests). Full suite 1,430 passed, 0 failed; typecheck and lint clean. **UNVERIFIED** in a browser, and only part 1 of UX-022. Nothing committed or deployed. All other findings are open with fixes designed (Batch A to D in 10).

## 7. Unresolved issues and deployment risks

- 33 register items (3 P1, 15 P2, 15 P3, no P0): 7 fixed and verified locally, 8 implemented but unverified, the rest open or blocked.
- Signed-in coverage gap (UX-024). Until closed, treat every signed-in finding as "probable".
- UX-011 touches assessment integrity: reproduce on Preview and get approval before changing.
- Turning the server guard on needs a signed-in walkthrough first, or valid users could be bounced.
- Evidence folder is 16 MB of screenshots; decide whether to commit it, use Git LFS, or keep it out of the repository.
- Five old `initiated` subscription payments on production still need checking against Paystack (owner action from earlier work).

## 8. Recommended release sequence

1. Create the test accounts on the Preview database; re-run the sweep per role (closes UX-024). 2. Batch A accessibility quick wins, then Batch E (one button system, motion, tokens). 3. Batch B resilience (banner, retry, error states, resume), then the save queue after reproduction and approval. 4. Server guard on Preview, then production. 5. Shared identity after measuring. 6. IA changes after short user tests.

## 9. Executive summary (for management)

QuizBox's public website is fast, mobile-friendly and largely accessible, and its engineering checks all pass (1,430 tests, no failures). The main risk to learners is not the look of the product but what happens when the connection is poor: the app does not tell users they are offline, may lose an answer without a clear warning, and can show a blank dashboard after one failed request. These are contained, low-cost fixes and are the first things to do. A smaller set of accessibility fixes (page titles, a skip link, headings, one colour, a useful 404 page) can ship in about a day.

This audit could not sign in to the product, so the signed-in screens (most of the product) were reviewed from the code and not seen running. Creating the test accounts on the Preview database (the supplied logins did not work there) would let the testing be completed within a day and would turn today's "probable" findings into confirmed ones. No changes were released; one small, tested wording change is ready on a local branch for review.

## 10. What it takes to become the product people seek out

The evidence says QuizBox does not need a new look; it needs to feel dependable and quick on a weak phone connection and to be consistent. In priority order:
1. **Never lose a learner's work, and say so when the connection drops** (UX-011, UX-022). This is the trust foundation for an assessment product.
2. **One button, one colour language, instant feedback** (UX-025, UX-026, UX-001): the same blue primary at 44 px everywhere, green for correct, amber for attention, red for errors, a visible response within 100 ms.
3. **Every screen knows where the user is and what to do next** (titles, one heading, "needs me now" dashboards, empty states with an action, a useful 404).
4. **Fast on a mid-range Android**: share the signed-in identity, prefetch sign-in, skeletons, budgets in `09` section 8.6.
5. **Prove it with people**: five users per audience, a System Usability Scale score of 80 or more, a real-device weak-network pass (`09` section 8.7). Until then, "sought after" is a goal, not a finding.
