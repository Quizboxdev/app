# QuizBox wording glossary

One spelling for each term a person sees. Code and screens follow this list. Add a term here before using a new one.

| Use | Not | Notes |
|---|---|---|
| Coins (balance, plan cost), one Coin | coins, coin, tokens | Always capital C |
| Subscribe (button, page title), subscription (the thing you hold) | Subscription page, Subscribe plan | "Subscribe to QuizBox", "Your subscription ends on …" |
| Price to be announced | TBA, TBD, GHS 0.00 | Shown whenever no price is set |
| Topic | strand, sub-strand, standard, indicator (in teacher/learner screens) | Curriculum codes (B5.1.2.3) are never shown to teachers or learners |
| Objective | learning indicator, learning objective | A single thing a learner should be able to do |
| Area / Topic area | Strand / Sub-strand | Only where a level name must be shown (curriculum browser) |
| Assignment | Task, homework (in buttons) | |
| Challenge | Competition (in learner and host screens) | Admin tools may keep "competition" where the database does |
| Under review, Taken down, Draft, Live | UNDER_REVIEW, TAKEN_DOWN, DRAFT, LIVE | Shown with the `humanize()` helper |
| Learner | Student (in new copy) | Existing "Student" role names stay |
| Question bank | Question Bank, QB | |

Rules
- No code, enum value or error code reaches the screen. Errors go through `describeErrorMessage` / `userFacingError`.
- Dates use `formatDate`, money uses cedis with two decimals (`GHS 12.50`), counts use singular/plural ("1 question", "2 questions").
- Curriculum labels come from `lib/curriculum/display.ts` (`topicLabel`, `objectiveLabel`, `curriculumTrail`, `levelDisplayName`).
- Placeholder wording ("coming soon") appears only where a feature is deliberately closed and says why.
