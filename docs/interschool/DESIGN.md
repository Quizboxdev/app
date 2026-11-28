# Inter-school competitions: design

Built 26 November 2026 on branch `claude/interschool-competitions`. State: code and migrations written and tested locally; **nothing applied to any database or deployed**.

## One engine, configured

Every kind of competition in the brief is the same data with different settings.

| Wanted | Setting |
|---|---|
| Open or invited | `participation` = `OPEN` / `INVITE` |
| Head to head, many schools | number of schools invited or allowed (`max_schools`) |
| Teacher or school organised | organiser is verified staff of a verified school |
| Sponsored | `funding` = `SPONSORED` with quotations and invoices |
| District, regional, national | `scale`, `region`, `district` (labels; they also decide whether approval is needed) |
| Individual or school team | `entry_mode` (individual entry without a school only in open competitions) |
| One or many class levels | one division per level; mixing levels needs `mixed` |
| Rounds, fixtures, progression | `rounds` per division: format, sections, timing, rule |

## What is reused, and what is new

| Reused | How |
|---|---|
| Accounts, schools, memberships, classes, learner class level | affiliation, level and staff checks |
| Question bank and curriculum tree | questions chosen by subject and topic with the bank's own listing and availability rules |
| Notifications, audit log, platform settings (flags) | all messages and every administrative action |
| Paystack, `payment_events`, webhook and return page | sponsorship payments use their own `QBS-` references |
| Quiz player look, share and Open Graph patterns, cron guard | player, campaign pages, reminders |

New: a private schema `quizbox_interschool` (17 tables), browser functions `public.interschool_*`, and screens under `/interschool`, `/inter-school`, `/admin/interschool` and `/verify`.

**Why not extend the challenge engine** (`challenge_campaigns`): it ranks individuals, allows six rounds, draws different questions per player, returns the answer key as soon as one player submits, counts each entry against the free allowance, and lets the creator read the answers. Each of these breaks a requirement here, and changing it would put the live challenges at risk. The two stay separate.

The older `/competition` pages and the sponsor engine (`quizbox_competition`) are untouched. There was no existing fixture feature to extend.

## Who may do what

| Action | Administrator | Verified school staff | Verified sponsor | Learner |
|---|---|---|---|---|
| Create a competition | yes | for their school | sponsored only | no |
| Publish without approval | yes | invited, free, not regional or national, up to 500 places | never | no |
| Invite schools, fixtures, finalise | yes | own competitions | own competitions | no |
| See learner names | all | own school; organisers see their results | never | own |
| Qualify by hand (manual rounds), disqualify, decide disputes | yes | own competitions | never | no |
| Correct a score | yes | no | no | no |
| Discounts, record payment, approve credit, waive, list publicly, set the price | yes | no | no | no |
| Enter, confirm, replace, lock a roster | view only (replace, confirm) | own school | no | register and withdraw self |

"Verified school staff" is an active teacher, administrator or owner membership of a school with `institutions.verified_at`. "Verified sponsor" is `sponsor_profiles.verification_status = VERIFIED`.

## Rules the database enforces

- **Capacity.** Overall, per division, per school, per level per school and number of schools. Every change that takes or frees a place locks the competition row first. Pending (unconfirmed) learners hold a place. Optional waiting list, promoted oldest first.
- **Affiliation.** A learner membership or class membership proves it; a school only chosen at sign-up leaves the registration pending until the school confirms.
- **Rosters** lock when the school or organiser locks them, and for everyone when the first round of the competition opens.
- **Papers** are frozen at publication (text, options, key, bank version). One paper per round, shared by competing schools; a fixture may have its own. A question is not repeated within a division.
- **Sittings.** One per learner per round. Question and option order differ per sitting. Server timer. Answers saved as given; a reconnect resumes the sitting. Answers arriving more than 20 seconds late are ignored. No score or key is sent before finalisation.
- **Scoring.** One mark per correct answer. School ranking: best N percentages, average, team total, or fixture points (3 win, 1 draw). Absent learners count as zero in average and team total. A school with fewer than the minimum takers is not ranked and forfeits its fixture. League and group stages always rank by fixture points.
- **Tie breaks.** Score, then shorter total time. Fixtures: score, then time; a knockout still level is decided by a repeatable draw recorded on the fixture. Exact ties share a rank and all qualify at a cut-off.
- **Progression.** Everyone, pass mark, top learners, top schools (per group in a group stage), fixture winners, pass mark with top learners, or manual. A round cannot be taken until the one before is final and the learner qualified. The next knockout draw is made automatically.
- **Fixtures.** Generated (league by the circle method, groups, knockout with byes to the first in the draw) or added by hand; a school's team for a level cannot overlap another fixture. Only unplayed fixtures change.
- **Corrections.** Score corrections are added rows with old and new value and reason; later carried totals are recomputed; announced qualifications stand once a later round has started. Disputes close seven days after a result.
- **Money.** Fee = participants × rate + setup − discount. The rate is copied to the quotation, so acceptance locks it. Publication and sponsored registration need paid, credit or waived invoices covering capacity. One credit per invoice; a second or wrong payment is flagged for refund. No automatic refund for unused places.
- **Privacy.** Tables are closed to browsers. Public pages never show learner details except short names of leading learners after results (managed learners excluded). Sponsors see counts and averages, hidden for groups under ten.

## Switches (all off)

`flags.interschool`, `flags.interschool_public`, `flags.interschool_sponsorship`, `flags.interschool_certificates`; setting `interschool.allow_managed_learners` (false); `interschool.rate_per_participant_minor` (unset until an administrator sets it).

## Decisions for the owner

1. **Under-13 (managed) learners cannot take part**, as in challenges today. Primary competitions need this decided (setting `interschool.allow_managed_learners`).
2. A school organiser who also competes can finalise, disqualify and decide disputes in their own competition (all audited, reasons required). Restrict to administrators if preferred.
3. In an open competition, one learner's registration enters their school and uses one of the school places.
4. The blueprint decision of 8 October paused campaign extensions until a maturity gate; this directive was treated as lifting that for inter-school competitions.

## Known limits

- Flyers and sponsor logos are **web addresses**; there is no file upload. A printable flyer is generated.
- There is no page called "Fun" in the code. Listed competitions appear on the home page, the competitions page and Open to join.
- Question availability is checked as the person publishing: an organiser without access to the market's curriculum sources would be told there are not enough questions.
- The readiness check counts approved questions; the stricter source check runs at publication and can still refuse.
- One sponsor per quotation; several sponsors are supported as several quotations, with one name and logo shown publicly.
- Reminders run from a daily schedule, which Vercel runs on Production only.
- Admin payment checks (`/admin/payment-checks`) do not list sponsorship attempts.
- Registrations for one competition are processed one at a time (see the concurrency results).
- Individual entries without a school cannot take part in fixture rounds.
