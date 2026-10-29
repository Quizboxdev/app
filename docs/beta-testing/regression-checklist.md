# Regression checklist (after every fix or deployment)

Run these quickly on Preview and tick each. Any failure blocks the release until reviewed.

- [ ] AUTH-02 wrong password shows a generic error
- [ ] STU-01 every sidebar link opens its page
- [ ] STU-02 Challenges opens the in-app list (no sign-in prompt, no bounce to Home)
- [ ] STU-03 a practice session starts, scores and saves
- [ ] STU-05 Subscribe page is styled and shows pay buttons on payable cards
- [ ] CHL-01 a public challenge can be played and appears on the leaderboard
- [ ] ADM-01 changing a price in Admin shows on the public Pricing page within a minute
- [ ] PAY-01 a test payment credits once
- [ ] SEC-01 and SEC-02 another person's results and admin pages stay closed
- [ ] UX-01 Pricing and Home have no sideways scrolling on a phone
- [ ] Public Pricing page shows real prices, not only "Price to be announced" (QB-AUD-002)

Reviewer checklist for pull requests: tests added for the fix and failing before it; no secrets or unrelated files in the diff (`git show --stat`); migrations come with a rollback and a pasteable apply command; wording follows `docs/ux/GLOSSARY.md`.
