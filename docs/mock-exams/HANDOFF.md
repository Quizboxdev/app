# Mock exams: handoff

Branch `claude/mock-exams`. Nothing here was applied to Preview or Production, deployed, listed on the live Marketplace, or paid for. The feature ships off (`flags.mock_exams`).

1. Impact analysis and architecture map: [IMPACT_ANALYSIS.md](IMPACT_ANALYSIS.md) (facts and assumptions marked, end-to-end data flow, decisions D1 to D16, open questions Q1 to Q10).

## 2. What was built, in the order to review it

| Step | Files | What it does |
|---|---|---|
| 1. Authoring | `supabase/migrations/20261122100000_mock_exams_authoring.sql` (+ rollback) | Tables `mock_exams`, `mock_exam_rounds`, `mock_exam_questions`, `mock_exam_versions`, `mock_exam_version_questions`; flag and settings; the builder functions. |
| 2. Class delivery and results | `20261122110000_mock_exams_delivery.sql` | `qb_mock_assign_class` (through the existing `qb_publish_assignment`), results, student-by-question review, export dataset. |
| 3. Marketplace | `20261122120000_mock_exams_marketplace.sql` | Listing pinned to a version, buyer's private copy of the purchased version, attempt guard. |
| 4. App layer | `lib/api/mock-exams.ts`, `lib/mock-exams/*`, `components/mock/*`, `app/(app)/mock-exams/*`, `app/api/teacher/mock-exams/export/route.ts` | Screens, wrapper, export route. |
| 5. Existing screens touched | `app/(app)/marketplace/{page,[slug]/page,mine/page}.tsx`, `app/(app)/admin/marketplace/page.tsx`, `app/(app)/seller/items/[id]/page.tsx`, `components/AppShell.tsx`, `lib/nav/role-routes.ts`, `lib/core/config.ts`, `lib/api/marketplace.ts` | A Mock exam badge, exam description on the listing, "My mock exams" with Start/Continue, staff review of an exam's contents, a menu entry (only while the flag is on), a message for the seller page. |

| 6. Sponsor delivery | `supabase/migrations/20261124110000_mock_exams_sponsor_delivery.sql` (+ rollback), `components/mock/FamilyGivePanel.tsx`, `LinkPanel.tsx`, `lib/mock-exams/links.ts`, `app/(app)/mock-exams/join/[code]/page.tsx`, and "My mock exams" on `marketplace/mine` | A sponsor gives an exam to their family (free) or shares it by link for places paid for in Coins; the learner's private copy and attempts are the same engine as a purchase. |

### User flows
- **Sponsor, family:** Share -> Give to my family -> tick children (only those the sponsor may assign work to) -> Give. Each child finds it under My question sets -> My mock exams for 90 days. Results show the child's name. Can be taken back.
- **Sponsor, link (church, alumni group, company):** Share -> Share by link -> choose places (1 Coin each, up to 1,000, paid from the wallet up front; short of Coins: buy exactly the missing amount, return, finish) and an optional closing date -> copy the link. Add places later (pay the difference) or close the link. Results show Joiner 1, 2, 3, no names. Places not used are not refunded.
- **Joiner:** opens `/mock-exams/join/<code>` -> signs in or up (the app's usual redirect) with a learner account -> Join (takes one place; free for them) -> My mock exams -> Start. A person already in keeps their place when the link is full or closed. A managed under-13 account cannot join by link (it can be given an exam by its family).
- **Author (teacher, verified organisation sponsor, staff):** Mock exams -> New -> details -> Build (rounds, automatic or by-hand choice, tally and shortfall help) -> Review and publish (readiness, scoring, version) -> Share (class, Marketplace) -> Results (summary, participants, question results, student-by-question grid, CSV/Excel).
- **Class learner:** finds the exam in Assignments like any other. Everything after that is the existing engine.
- **Marketplace buyer (a learner, not a minor):** Marketplace card with a Mock exam badge -> listing page (shape of the exam, no questions) -> existing checkout -> My question sets -> My mock exams -> Start/Continue -> existing attempt screen -> existing result screen.
- **Staff:** the existing listing review now shows the exam's real contents, with answers, and a warning when a question changed.

## 3. Data model and who may do what

Tables (all RLS on, no grants to `anon` or `authenticated`; every read and write is through a function):
- `mock_exams` (draft state, owner, settings), `mock_exam_rounds` (year, subject, topic, count; one round per topic), `mock_exam_questions` (the chosen question per round), `mock_exam_versions` and `mock_exam_version_questions` (immutable: triggers refuse update and delete; each question keeps `question_id`, `question_version`, `topic_id`, `curriculum_node_id`, `external_id`, `source_type`, `source_version`, `curriculum_reference`).
- `mock_exam_assignments` (version -> class assignment), `mock_exam_enrolments` (version -> buyer's purchase -> private assessment).
- Added columns: `mk_items.mock_exam_id`, `mk_items.mock_version_id`, `mk_purchases.mock_version_id` (all nullable).

| Action | Who | Where it is enforced |
|---|---|---|
| Build, edit, publish, archive, read an exam | Its owner, if still an active teacher, a verified ORGANIZATION sponsor, or staff | `quizbox_mock.author_kind` and `own_exam` in every function; another user gets `QB_NOT_FOUND` |
| Pick questions | Owner | Only listable, available questions of the round's own topic; no duplicate (`duplicate_group_id` or text hash); `QB_TOPIC_SHORT` instead of substitution |
| Assign to a class | Owner who teaches or manages the class, class at the exam's stage | `qb_mock_assign_class`; refuses stale versions |
| Sell | Owner who is a teacher, or a verified ORGANIZATION sponsor (only while `flags.mock_exams` is on), and a Marketplace seller | `quizbox_mock.sellable`, `qb_mk_seller_save` (replaced in the marketplace migration; the rollback restores the teachers-only original), then the existing `qb_mk_*` rules (verified seller to submit, staff approve, price GHS 5 to 200, 60/40 split, payouts) |
| Buy | Any signed-in adult learner not already owning it, not the seller | Existing `qb_mk_prepare_purchase` and checkout, unchanged |
| Start as a buyer | The buyer, while the purchase is active and unexpired | `qb_mock_start_purchased`, and a trigger on `attempts` that refuses MOCK_EXAM attempts without a live purchase |
| Read results and export | The exam's owner | `qb_mock_results`, `qb_mock_result_rows`, `qb_mock_export`; class attempts only for assignments the caller owns or manages; marketplace buyers as "Buyer N" |
| Approve a listing | Staff with the review duty | Existing `qb_mk_admin_review`; `qb_mock_admin_listing` shows the contents |

Reused, not rebuilt: question availability and picker (`quizbox_topic.*`), the class publisher, the attempt engine and scoring, the Marketplace listing, checkout, Paystack settlement, 60/40 split, 90-day access and refund reversal, the CSV/Excel writers and their formula guard.

## 4. Tests and checks (actual results)

Run in this branch on 22 November 2026:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | no errors |
| `npx eslint .` | 0 errors, 2 warnings in older test files that this change did not touch |
| `npx vitest run` | see the PR description for the final count |
| `npm run build` | see the PR description |

New tests: `mock-exams-authoring-sql.test.ts` (19), `mock-exams-delivery-sql.test.ts` (12), `mock-exams-marketplace-sql.test.ts` (15), `mock-exams.test.ts` (20 with the route test), `app/api/teacher/mock-exams/export/route.test.ts` (7), `components/mock/mock-screens.test.tsx` (15), `lib/api/mock-exams.contract.test.ts` (37). What they cover: multi-level allocation and counts, shortfall and recovery, duplicates (including a copy under another topic), ownership, sponsor eligibility, class access, paid entitlement, idempotent purchase, refund, expiry, version stability after publishing and after purchase, scoring display for all answer types, privacy of buyers, CSV and XLSX output, formula injection, the row cap, rollback and re-apply, and that an ordinary Marketplace sale is unchanged.

## 5. What is NOT proven

1. **The real engine was not run.** The SQL tests use stand-ins for `qb_publish_assignment`, the attempt tables, the snapshot trigger (`qb_snapshot_assessment_question`), `qb_question_is_available` and the class tables. The Marketplace migration and the topic picker are the real code. The first time `qb_publish_assignment` and `qb_start_attempt` meet these functions will be on Preview. Check there first: (a) assigning a mock exam to a class; (b) a buyer's Start button opens an attempt; (c) `assessments.assessment_type = 'ASSESSMENT'` with `reference_type = 'MOCK_EXAM'` is accepted by the market and content guards; (d) the result page shows for a buyer.
2. **No browser check.** The screens were type-checked, linted and rendered to static markup. They were not opened in a browser, in light and dark mode, or on a phone. The Chrome tool was not available.
3. **No payment.** Purchases were simulated at the database level with the same functions the Paystack webhook calls (`qb_mk_set_payment_item`, `qb_mk_fulfil_purchase`). Paystack, the checkout route and the coin ledger were not exercised.
4. **Release kit.** Parts and `index.json` entries for the three migrations are added and pass `release-kit.test.ts`. `scripts/release/release-files.txt` and the two fingerprint scripts were not regenerated: running the generator also rewrites about 45 files of older migrations (it splits them differently from what is committed), which is unrelated churn. Regenerate them in a separate change if the owner wants the fingerprints to include these objects.

## 6. Known gaps and decisions still needed

- **Sponsors** can build, publish and SELL an exam (they register as a seller like a teacher; same review, price limits, split and payouts). They still cannot give it to a class, because sponsors have no classes: how a sponsor "pushes" an exam to learners without selling it is an open product decision (Q1).
- **One topic gives at most 10 questions to an exam** (`mock_exams.max_per_topic`, enforced in `qb_mock_round_save`, error `QB_MOCK_TOPIC_CAP`) and an exam holds at most 100 (`mock_exams.max_questions`). A mock exam is built from several topics because of this.
- **Marketplace minimum is 10 questions** (existing setting), so a 5 to 9 question mock exam can be assigned to a class but not sold.
- **Pass mark** is the engine's fixed 40% for assignments; it is not per exam.
- **Cross-stage exams** are refused (Q2). **WAEC mapping** does not exist; BECE and WASSCE readiness are labels (Q6).
- **A buyer's exam can be stuck** if a question is edited or withdrawn between publishing and purchase (the sale stands, the private copy cannot be built, the buyer sees a clear message). The author publishes a new version, but the buyer's purchase stays on the old one. Resolve by refund or by support. A fix needs a product decision (refund automatically? let staff re-pin?).
- **A refund ends new attempts only.** An attempt already in progress may finish.
- **Co-teachers** who manage a class but do not own the exam cannot read its results; only the owner can.
- **Minors** cannot buy (existing rule). A parent buying for a child is not linked to the child's account.
- **Option order is never shuffled**, and class assignments use the publisher's fixed question order.
- Late submission, attempts and resume are the engine's. For a class, the closing time ends starting and caps the attempt's deadline.
- Retention: versions, enrolments, assignments and purchases are kept on rollback and are never deleted by the feature. Drafts that were never published can be deleted by their owner.

## 7. To apply (owner, Preview first)

Do not apply anything until the PR is merged and `main` is pulled. Then, with the guarded script used for the other migrations:

1. `20261122100000` (authoring), 2. `20261122110000` (delivery), 3. `20261122120000` (marketplace; needs `20261043100000` to be on that database), 4. `20261124110000` (sponsor delivery; needs the family workspace migrations and `qb_challenge_active_user`, both already on Preview).
2. Turn on `flags.mock_exams` in Preview only. Leave `flags.marketplace` as it is on each environment. For the family gift also `flags.family_workspace` (already on in Preview); for links turn on `flags.mock_exam_links` (new, off).
3. Preview click-through (use the existing test teacher, a test class and two test students): build a 20-question exam over two years; make one topic short and check the recovery help; publish; assign to the class; take it as a student; read the results; download CSV and Excel and open the Excel file; (if the Marketplace is on in Preview) list it at a test price, approve it as staff, buy it with the Paystack test mode, start it, take it, then refund it and confirm a new attempt is refused.

## 7b. Sponsor delivery: rules, and what is NOT built

- **Who:** gifts to the family: a sponsor (parent, alumni family, organisation) with a family workspace, to children they may assign work to (`family_can(..., 'assign')`; a plain sponsor link carries no assign permission, so those children are refused). Links: verified ORGANIZATION or ALUMNI sponsors only. Authors widen to verified alumni sponsors and sponsors with a family workspace (they can build to give to their family). Selling stays teachers and verified ORGANIZATION sponsors.
- **Money:** 1 Coin a place (`mock_exams.coins_per_seat`), up to 1,000 (`mock_exams.max_link_seats`), spent through the same `qb_coin_spend` as quiz seats; adding places charges only the difference; a failed payment leaves nothing behind. No refund of unused places (same as quiz seats). The link's closing date is at most a year away (default 90 days); each joiner has the exam for 90 days (`mock_exams.access_days`).
- **Not built (decide next):** (1) **a sponsor's own questions.** Exams are built from the approved question bank only, because question loading is administrator-only by design. The sponsor-document generation pipeline exists for competitions but is not connected to mock exams; it would need staff approval of every question. (2) A free allowance of places (quiz seats give 5 free; links give none). (3) Refunding unused places. (4) Joiners' names for the sponsor (shown as Joiner N for privacy). (5) Re-pinning a link to a newer version.
- **Not proven:** same as section 5, plus the wallet and checkout stand-ins: the real `qb_coin_spend`, Paystack top-up return and the family permission check were not exercised in this branch; run the click-through below on Preview. Sponsor path: parent gives to two children, one with and one without the assign permission; alumni sponsor with a funded wallet creates a link for 3 places, three learners join, the fourth is told it is full; add places; close; results show Joiner N.

## 8. Statement

No Production or Preview deployment, no migration applied, no live listing created and no real payment made. All work is local on `claude/mock-exams`.
