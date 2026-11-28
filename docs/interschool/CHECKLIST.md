# Implementation checklist, test results, blockers

26 November 2026. **Built** = code exists and automated checks pass on this machine. Nothing has been applied to Preview or Production, deployed, or looked at in a browser.

## Against the brief

| § | Item | State | Not done or limited |
|---|---|---|---|
| 1 | Organisers and one engine | Built | |
| 2 | Wizard, draft, preview, publish, pause, close, cancel, duplicate | Built | Flyer and logo are web addresses, no upload |
| 3 | Level divisions | Built | |
| 4 | Registration, affiliation, capacity, waiting list, replacement, lock | Built | |
| 5 | Fixtures: head to head, league, groups, knockout, byes, auto draw, reschedule, cancel, clash check | Built | A fixture uses the school's whole division roster (no per-fixture team selection). Own subjects and duration per fixture exist in the database, not on the screen. Clash check is per class level |
| 6 | Rounds and progression | Built | |
| 7 | Questions, secure sitting, scoring, rankings, disputes, corrections | Built | Topic choice by strand down to indicator; difficulty per subject |
| 8 | Sponsorship billing and Paystack | Built | No printable invoice or quotation document. Online payment not exercised against Paystack |
| 9 | Campaign page, links, QR, WhatsApp, preview card, flyer, listing, source tracking | Built | No "Fun" page exists; QR not scanned on a device |
| 10 | Administrator, school, sponsor, learner screens | Built | Reports are on-screen figures and a results CSV only |
| 11 | In-app notifications, reminders, certificates | Built | No email. Reminders need the Production schedule or a manual call |
| 12 | Security and technical requirements | Built | No independent security review |
| 13 | Phases 1 to 5 | Built | Preview verification outstanding |
| 14 | Acceptance tests | Local only, see below | Preview demonstration written, not run |

## Test results (26 November 2026)

- Type check: passed. Lint: no errors (3 older warnings in unrelated tests). Production build: passed. Production dependency audit: 0 vulnerabilities.
- Whole suite: 2,594 passed, 119 skipped (live suites that need a database), 0 failed.
- Inter-school database tests (`lib/core/interschool-*.test.ts`) run the five migrations unchanged in an isolated PostgreSQL (PGlite) with **stand-in** accounts, curriculum, question bank, notification and payment tables. The real listing and availability rules, `qb_challenge_admin`, sign-up triggers and row-level policies of the live database are **not** exercised.
- Concurrency and throughput: `CONCURRENCY_RESULTS.md`, from `scripts/interschool/concurrency_test.py` on a local PostgreSQL 17.6. All rules held with 100 connections. Contested registration ran at 60 to 120 per second on one laptop (it varied between runs). Capacity of the hosted plan has **not** been measured.

| Acceptance check | Covered by |
|---|---|
| Open and invitational | registration tests |
| Allocations never exceeded; concurrent registration | registration tests; concurrency tests 1 to 3 |
| Questions match level; one and several subjects | configuration tests |
| Fixtures; pass marks and progression; rankings | play tests |
| Timers and scores secure | sitting tests; concurrency test 3 |
| Invoice calculation; unverified payment cannot activate; duplicates | billing tests; concurrency test 4 |
| Links and QR; expired rejects registration | unit and registration tests (QR generated, not scanned) |
| Sponsor sees no learner | billing and privacy tests |
| Existing features still work | whole suite and build only |

## Blockers

1. Migrations must be applied to Preview by the owner (`AGENTS.md` rule 5).
2. The branch's Preview deployment has not been checked in a browser. The screens need the migrations applied and the switches on.
3. The demonstration script has not been run; it writes to live-shaped tables this machine does not have and may need small fixes on first run.
4. Primary competitions need a decision on managed under-13 learners.
5. Sponsorship needs a price per participant to be set, and a Paystack test key on Preview.

## Assumptions

- "Verified teacher" means staff membership of a verified school.
- All times are Ghana time (GMT).
- One mark per question; no negative marking.
- "Close" closes registration; rounds still run for those entered.
- Before the migrations are applied, a merged build behaves as today (switches read false, public lists come back empty); the daily reminder call would report an error until then.
