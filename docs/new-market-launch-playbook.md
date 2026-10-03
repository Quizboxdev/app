# New market launch playbook

Repeatable process for launching QuizBox in a new country (e.g. Nigeria, Kenya) **without code
changes**. Every step is a Super Admin action in the app unless stated. Country rules live in market
data (`markets.configuration`), never in shared code.

Screens: **Admin › Market Setup** (`/admin/market-setup`), **Admin › Markets** (`/admin/markets`:
Authorities, Curricula by Market, User/Sponsor Markets, Source Documents), **Admin › SME Reviewers**,
**Admin › Compensation**.

| # | Step | Where / how | Done when |
| --- | --- | --- | --- |
| 1 | Create country | Market Setup › New market: ISO-2, ISO-3, country name. | Country listed; readiness no longer reports `COUNTRY_NOT_CONFIGURED`. |
| 2 | Create market | Same form: market name. Status starts **DRAFT**. Tick *Test market* only for rehearsal markets (hidden from signup unless the `TEST_MARKETS_VISIBLE` flag is enabled in a non-production project). | Market row in DRAFT. |
| 3 | Currency, time zone, locale | Same form (ISO-4217 currency; a new currency also needs its name). Default SME currency defaults to the market currency. No FX is applied anywhere. | `CURRENCY_NOT_CONFIGURED` / `LOCALE_OR_TIMEZONE_MISSING` cleared. |
| 4 | Curriculum authority | Markets › Authorities › Create (market, code, official name). | `CURRICULUM_AUTHORITY_MISSING` cleared. |
| 5 | Curriculum | Market Setup › Register a curriculum: authority, code, name, version, effective dates, **official source name and hash** (provenance is mandatory). It is created **inactive**. | Curriculum listed under Curricula by Market (inactive). |
| 6 | Education levels and grades | Market Setup › Edit market: `CODE: Label` per line for levels; `CODE: Label \| LEVEL` for grades. Optional `canonical` aliases are data, not code. Choose the self-practice grade policy (STRICT_GRADE default; OPEN_LEVEL only by explicit decision). | `EDUCATION_LEVELS_MISSING` / `GRADES_MISSING` cleared; signup shows the grades. |
| 7 | Subjects | Same form, `CODE: Label` per line. | `SUBJECTS_MISSING` cleared. |
| 8 | Ingest official sources | Import curriculum nodes with the existing curriculum import tooling into the new curriculum; register official source documents (rights confirmed, checksum, extracted text). | Nodes present; source documents in `review`. |
| 9 | Map content | Attribute questions to the curriculum through their nodes (`quizbox_market.attribute_legacy_by_node`) or import with explicit curriculum ids. Ambiguous items stay in `market_attribution_issues`; never attribute by guesswork. | Attribution queue reviewed. |
| 10 | Assign SMEs | SME Reviewers: verify profiles (applications arrive from onboarding as `pending`), add domains with market + subject + level + grades, grant capabilities. | Readiness shows SME coverage > 0. |
| 11 | Review and approve | Approve source documents (Markets › Source Documents) and activate the curriculum (Curricula by Market › active). SME review questions. Nothing is auto-approved. | `APPROVED_SOURCE_MISSING` / `ACTIVE_CURRICULUM_MISSING` cleared. |
| 12 | Configure compensation | Compensation › Policies/Versions: market, currency, tier, subject, level, rates, effective date. Resolution: sponsor → market → global. Historical earnings are immutable. | Policy version effective. |
| 13 | Market admin + isolation tests | Add a market admin membership (User/Sponsor Markets). Run `npm test -- lib/content/multi-market.test.ts` and a branch smoke: a test student of the new market sees only its content; a Ghana user cannot reach it. | `MARKET_ADMIN_MISSING` cleared; isolation evidence captured. |
| 14 | Activate | Market Setup: DRAFT → CONFIGURING → READY → ACTIVE. READY/ACTIVE are refused while any blocker remains. | Market ACTIVE; country selectable at signup. |
| 15 | Monitor | Market Setup › Platform overview (users, questions, readiness, unresolved items, pending country changes), Security/Performance Advisors, attribution queue. SUSPENDED halts access without deleting data. | Weekly review recorded. |

Rules that must not be bypassed:
* Users confirm their country at signup; IP location is never authoritative.
* Students and teachers have one primary market; changing it is a reviewed request (Account › Change country).
* National curricula are never merged. Multi-market curriculum-aligned competitions need an approved curriculum source in every selected market; international competitions use sponsor sources or an approved global source pack only (`lib/content/international.ts`).
* Teacher cross-grade assignments require the explicit, audited override.
