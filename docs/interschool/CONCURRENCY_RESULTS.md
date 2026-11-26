# Inter-school concurrency and capacity test

Run on 2026-11-26 on a developer laptop. PostgreSQL 17.6 on x86_64-windows. Local database only.

## 1. Oversubscription: 600 learners, 150 places, 40 per school, 100 connections
- PASS: exactly the capacity is filled, never more (150 of 150)
- PASS: no school goes over its allocation (largest school 25 of 40)
- Answers given: IS_COMPETITION_FULL x450, CONFIRMED x150
- PASS: every call got an answer

## 2. Waiting list and school limit: 300 learners, 60 places, 3 schools allowed
- PASS: places filled exactly, the rest queued (held 60, rows 300)
- PASS: no more schools than allowed (3 of 3)

## 3. The same learner from many devices
- PASS: one registration only
- PASS: one sitting only
- PASS: one submission, one score

## 4. The same payment arriving many times
- PASS: one payment funds the invoice, the others are flagged for refund (successful/duplicate = 1 4, funded 100)

## 5. Throughput on this computer

| Step | Connections | Calls | Seconds | Calls per second | Average ms |
|---|--:|--:|--:|--:|--:|
| Registration, contested (test 1) | 100 | 600 | 6.3 | 121.435980 | 823.479 |
| Registration with waiting list (test 2) | 100 | 300 | 6.0 | 66.484219 | 1504.116 |
| Registration, 1,200 learners, places free | 100 | 1,200 | 11.3 | 120.680129 | 828.637 |
| Start a 20-question paper | 100 | 1,200 | 4.7 | 380.537535 | 262.786 |
| Save one answer | 100 | 4,000 | 4.3 | 1430.662751 | 69.898 |
| Reopen and submit | 100 | 1,200 | 5.8 | 293.560817 | 340.645 |
- PASS: all 1,200 sittings submitted without errors (1200 submitted)
| Finalise a round of 1,200 learners | 1 | 1 | 0.76 | - | - |
- PASS: results cover every learner
| Public competition page | 100 | 2,000 | 5.5 | 547.982588 | 182.488 |

These figures are the database on one laptop with no web server, network, authentication or connection pooler in between. They show that the rules hold under contention and give an order of magnitude; they are NOT a measure of what the hosted Preview or Production plan can carry.

Failures: none
