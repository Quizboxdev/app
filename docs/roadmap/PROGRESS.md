# QuizBox roadmap and progress tracker

Single source of truth for "where are we". Updated whenever an item changes. When the owner asks for status, report every row grouped by status, with counts.

Created 2026-10-10. Last updated 2026-10-10 (slice B).

**Status legend:** DONE · IN PROGRESS · TODO · BLOCKED (waiting on the owner) · DEFERRED (deliberately later)
**Who:** Claude (code, tests, docs) · Owner (dashboards, credentials, decisions, real-world checks) · Both

## Method

1. **Finish the current system first, including the AI question engine (Stage 1). Add the new features second (Stage 2).**
2. **Order by dependency, fewest first.** Nothing starts before the rows in its *Depends on* column are DONE, except work that touches no shared code (new files, docs, tests).
3. **Every row has evidence.** DONE means verified: a test, a build, a live check, or an owner confirmation, noted in the row. Nothing is marked DONE on intent.
4. **One change per commit, tested before it is committed:** typecheck, unit tests, production build.
5. **The owner holds credentials and production writes.** I never ask for passwords or keys in chat. Production database changes are run by the owner (dashboard or runbook) with a backup first.
6. **Extension work adds, it doesn't rewrite.** New features reuse the existing competition, scoring, question and identity code (blueprint rule: no second engine, no second user table).

## Gates

- **Gate 1, core ready for a pilot:** every A, B, C, D row DONE, L1–L5, L7 and L9 DONE, L6 and R1–R6 DONE, T1–T4 DONE, G1–G6 DONE.
- **Gate 2, Stage 1 complete:** Gate 1, plus every S row DONE, every F row DONE or DEFERRED by decision, plus G7 (pilot) passed with no P0/P1 defects.
- **Stage 2 starts at Gate 2.** Exceptions that touch no existing behaviour may start at Gate 1: X0 (documents) and X1 (design-system components, new files only).

---

# STAGE 1: Finish the current system

## A. Access and sign-in
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| A1 | Password-reset link opens "Set a new password" (recovery script fixed for current auth-js) | DONE | Claude | | Commit 69887ec; live bundle verified 2026-10-08; owner tested |
| A2 | Supabase Site URL = https://www.quizbox.io and redirect allow-list | DONE | Owner | | Screenshots 2026-10-08. Optional: replace localhost entry with `http://localhost:3000/**` |
| A3 | Admin login restored | DONE | Owner | | Password reset by SQL 2026-10-08 |
| A4 | Password policy for ages 8–18 (6 chars, no character rules, leaked-password check off, app-side easy-password check, passphrase suggester) | DONE | Both | | Commit 4e914e0 live; docs/security/password-policy.md |
| A5 | Server-side enforcement of the easy-password check (Auth hook), so API calls can't bypass it | TODO | Claude | A4 | Optional hardening; documented as the follow-up |
| A6 | Test accounts `*.test@quizbox.local` disabled | DONE | Owner | | All 6 banned until 2999 (SQL output 2026-10-08). They can't be deleted: immutable history |
| A7 | `test_credential_rotation` release gate accepts "disabled" evidence (or rotation proven) | TODO | Claude | A6 | Gate currently expects rotated credentials |
| A8 | Sign-up country list shows Ghana | DONE | Owner | | Public RPC returns Ghana (9 grades, 7 subjects) |
| A9 | Sponsor sign-up and onboarding | DONE | Owner | A8 | Owner signed up as sponsor (Hover Farms) 2026-10-10 |
| A10 | Student sign-up, onboarding (SHS1) and Practise shows questions | TODO | Owner | A8, D1 | Needs a real email; also tests the new password flow |
| A11 | "Save market" asks for confirmation when ticking "Test market" on an active market | TODO | Claude | | Prevents hiding a live market from sign-up |

## B. Release and deployment hygiene
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| B1 | Vercel production tracks `main` | DONE | Owner | | Settings → Environments screenshot |
| B2 | Release branch merged to `main`; work committed | DONE | Both | | main = 4e914e0 |
| B3 | Build fails when Supabase key is missing (instead of deploying broken sign-in) | DONE | Claude | | Commit 4b3a90d; live build passed |
| B4 | Broken tenant pages removed | DONE | Claude | | Commit 4a0d316 |
| B5 | Menu and page links to switched-off sponsor pages hidden; regression test | DONE | Claude | | Commit 1bc073a |
| B6 | Hints and formats on Register-a-curriculum and Coverage-Targets forms | DONE | Claude | | Commit d1cec63; seen live |
| B7 | Sign-up form says "No countries open yet" instead of loading forever | DONE | Claude | | Commit 30b3a17 |
| B8 | Sponsor dashboard honest while creation is off; Competitions empty state | IN PROGRESS | Both | | Commit 8ccd614 local. **Owner pushes** |
| B9 | GitHub `release/public-homepage-hardening` in step with `main` | TODO | Owner | B8 | `git push origin release/public-homepage-hardening` |

## C. Production database parity and security
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| C1 | Fix production and restore pooler passwords (PGPASSFILE) | BLOCKED | Owner | | Rejected 2026-10-06. Blocks C2–C5 |
| C2 | Apply 20261009100000, 20261010100000, 20261010110000 to production (runbook: backup, apply, verify, rollback ready) | BLOCKED | Both | C1 | docs/release/production-migration-runbook.md. Preview-only today |
| C3 | Record hand-applied migrations in production history (20261011100000/110000/120000 and any others) | TODO | Both | C1 | Needs owner authorisation. Repair SQL in docs/release/ |
| C4 | Schema parity: production fingerprint = repo chain | TODO | Both | C1, C2, C3 | scripts/release/ tools |
| C5 | Backup and isolated-restore evidence (`backup_restore` gate) | TODO | Both | C1 | scripts/restore-isolated.ps1 |
| C6 | Grant hardening: remove `TRUNCATE` from `authenticated` (92 tables) and unneeded `anon` grants (45) | TODO | Claude | | Migration + rollback; prove on Preview first; then production via runbook |
| C7 | Make migrations self-contained (e.g. `qb_is_platform_admin()`) so the repo chain replays from empty | TODO | Claude | | Needed for tests and the future campaign schema |
| C8 | Leaked-password protection: accepted risk, gate replaced by `password_policy` | DONE | Owner | | Decision 2026-10-09 |
| C9 | All P0 release gates PASS (`release:check`) | TODO | Both | A7, C2, C4, C5, D1, G2 | scripts/release-check.ts |

## D. Content and curriculum
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| D1 | Wave 1 (45 questions: SHS1 Computing, Mathematics, Science) approved and published | DONE | Owner | | Screenshot 2026-10-08 |
| D2 | Development-era questions retired | DONE | Owner | | 86 archived 2026-10-07 |
| D3 | Ghana market configuration and Primary curriculum (B4–B6) applied | DONE | Owner | | 2026-10-07 (by hand) |
| D4 | SHS2 / SHS3 curricula and content | TODO | Both | | No curriculum beyond B10 (= SHS1) |
| D5 | 47 curriculum sources: set official domains → fetch → approve → activate | TODO | Owner | | /admin/curriculum-sources. Sources sit in "pending" |
| D6 | Curriculum activated; Ghana market readiness = Ready | TODO | Owner | D5 | Readiness shows "approved source missing, curriculum source missing, SME coverage 0" |
| D7 | SME reviewers onboarded; workload and compensation policies set | TODO | Owner | | SME coverage is 0 today |
| D8 | Coverage targets set per curriculum | TODO | Owner | D6 | Now has a curriculum dropdown and format hints |

## E. AI question engine (Content Factory generation adapter)
Contract (docs/content-factory.md): `POST {kind:"curriculum", prompt, spec}` → a JSON array of exactly `spec.count` candidates. Env: `QUIZBOX_GENERATION_PROVIDER`, `_MODEL`, `_ENDPOINT`, optional `_API_KEY`. Candidates enter human review; nothing auto-approves. No provider exists today.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| E1 | Adapter service: same-app server route, provider chosen by env. Google Gemini built first | DONE | Claude | | `app/api/generation/curriculum`, lib/generation/adapter.ts; 17 tests; setup in docs/ai-question-engine-setup.md |
| E1b | Anthropic Claude backend behind the same route | DEFERRED | Claude | E1 | Owner decision 2026-10-10: questions are loaded from files (track L); API generation is optional and off |
| E2 | Source-grounded prompt, schema validation, exact-count enforcement, evidence kept on every candidate | DEFERRED | Claude | E1 | Owner decision 2026-10-10: questions are loaded from files (track L); API generation is optional and off |
| E3 | Tests: mocked provider, contract test against `configuredFactoryProvider` / `generateQuestions`, failure and timeout paths | DONE | Claude | E1 | lib/generation/adapter.test.ts (17 tests incl. end-to-end contract and 401 path) |
| E4 | Preview run: small campaign (one indicator, ~5 questions) from generation → review → publish | DEFERRED | Both | E3, C7 | Optional: only if API generation is wanted later. Setup in docs/ai-question-engine-setup.md |
| E5 | Production enablement: key in Vercel, small controlled campaign, human review | DEFERRED | Owner | E4, D6 | Owner decision 2026-10-10: questions are loaded from files (track L); API generation is optional and off |
| E6 | Cost and rate controls (`tokens_per_question`, per-campaign caps, kill switch) | DEFERRED | Claude | E1 | Owner decision 2026-10-10: questions are loaded from files (track L); API generation is optional and off |

## F. Sponsor competition engine (built, gated off)
Status per docs/sponsor-competition-activation.md: built and tested on local fixtures; not release-ready.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| F1 | Domain model, migrations, workspace, upload/extract, candidates, review bridge, snapshots, delivery, results (fixtures) | DONE | Claude | | lib/competition/*, 6 sponsor migrations |
| F2 | Generation for sponsors uses the same adapter (sponsor contract `{input, chunks}`) | DEFERRED | Claude | E1 | Not needed: sponsor pools are loaded by admin from files (track S) |
| F3 | Browser acceptance of the full flow on a Preview branch | TODO | Claude | E4 | Now for admin-driven competition setup (S5). Create → load pool → publish → participate → results |
| F4 | Background scheduling for extraction and generation | DEFERRED | Claude | E1 | Not needed without sponsor-side generation |
| F5 | Aggregate analytics across competitions | TODO | Claude | F3 | |
| F6 | Leaderboard display names (privacy rules for minors) | TODO | Claude | F3 | |
| F7 | Balanced publication (difficulty/topic) and oversight UI completed | TODO | Claude | F3 | |
| F8 | Sponsor self-service workspace stays off; competitions are set up by admins only | DEFERRED | Owner |  | Decision 2026-10-10. `local-gate.ts` keeps forbidding it on production |
| F9 | Sponsor onboarding verified | DONE | Owner | | Hover Farms 2026-10-10 |

## G. Learner, school and pilot readiness
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| G1 | Learner journey verified on the live site (= A10) | TODO | Owner | A10 | |
| G2 | Live acceptance suite green on Preview (101+ tests) | TODO | Claude | C6 | `npm run acceptance:live` |
| G3 | Teacher overview analytics paginated on the server | TODO | Claude | | Doc: "must not silently limit rows" |
| G4 | Media upload/retrieval verified end to end | TODO | Both | | |
| G5 | Responsive screenshots / visual check at phone widths | TODO | Claude | | |
| G6 | Mutation/role matrix and cross-tenant negative tests completed | TODO | Claude | C6 | Partial today |
| G7 | Pilot: one school, 2–4 weeks, no P0/P1 defects | TODO | Owner | Gate 1 | |
| G8 | Teacher-managed learner accounts for under-13s (no email; teacher resets passwords; consent rules) | TODO | Both | G1 | Needs owner decision D-3; design first |
| G9 | Support and incident basics: error monitoring, contact route, runbook | TODO | Claude | | |

## L. Question loading engine (one system, admin only)
Design: docs/question-loading/DESIGN.md. Template and prompts: docs/question-loading/. Audit of the first sample files: docs/uat/sample-delivery-audit-2026-10-10.md.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| L1 | Template (xlsx + csv, 20 columns incl. topic and concept) and Gemini prompts: one generator for any source that asks only for the level and writes blocks of 50 questions per topic in batches of 100, and one batch-check prompt | DONE | Claude | | docs/question-loading/ (prompt v3) |
| L2 | Trial: run the generator prompt on a real source in Gemini, check with the checker and by hand, refine the prompts | IN PROGRESS | Both | L1 | Trial 2 (prompt v3, Social Studies B7 topics 1-2, 100 rows): topic map covers all 16 indicators; both topics exactly 50 with 15/20/15 and 5 concepts at 10 each; 100/100 quotes verbatim; 0 page errors. Failures: correct answer only A or B (72/28), correct option longest in 87 of 96, many silly wrong options, one LaTeX formula. Prompt v3.1 adds length, plausibility and scope rules; rerun topics 1-2 |
| L3 | Loader core (pure code): read .xlsx/.csv, validate against the template and database rules, quality flags (templated or repeated explanations, repeated stems, off-topic options, duplicates, answer-letter balance, 'according to the curriculum' stems), source verification (quotes, pages, indicator codes against the PDF), automatic answer-letter rebalancing, problem list | DONE | Claude | L1 | lib/question-loading/ (45 tests) and `npx tsx scripts/check-question-file.ts` (--source, --rebalance). Blocks the script-built Science sample (489/500 templated explanations) and catches the real issues in the Gemini sample |
| L4 | Admin screen "Load questions": scope picker, upload, check report, load in tracked batches (replaces the old CSV box) | DONE | Claude | L3, D6 | Screen at /admin/question-loading (checks the file in the browser, places questions on the loaded indicators, loads in calls of up to 500 rows); `qb_question_load` in 20261012120000_question_load.sql runs the governed import; 4 integration tests on the real import. NOT applied to any database yet |
| L5 | Batch tracking: file hash, who, when, counts, report, status; same file can't be loaded twice | DONE | Claude | L4 | `question_load_batches` row per file (unique file hash, LOADING / LOADED / PARTIAL / FAILED, counts, row errors); same file refused with QL_LOAD_FILE_ALREADY_LOADED. Applies with L4 |
| L6 | Route every loaded question to the SME review pool (track R); a batch is complete when each question has an SME decision | TODO | Claude | L5, R2 | Replaces the earlier idea of batch sample acceptance; decision D-10 |
| L7 | Truthful provenance labels: internal "AI-assisted, SME-verified"; learners see "Reviewed by subject experts" | TODO | Claude | L5 | Decision D-7 |
| L8 | Triage of the 17,000 questions in Google Sheets: who made them and under what rights, sample audit, convert to the template, staged load | TODO | Owner | L3, L6 | docs/IP_PROVENANCE.md |
| L9 | One clean subject and grade code list for the pickers (e.g. `Mathematics` vs `COMPUTING`, B10 vs SHS1) | TODO | Claude | D6 | |
| L10 | Import from a Google Sheets link | DEFERRED | Claude | L4 | Upload first |
| L11 | Curriculum extract from NotebookLM (one-shot data-table prompt) + verification against the original PDFs | IN PROGRESS | Both | L1 | 2026-10-10: JHS 1,248 indicators / 10 subjects and SHS 2,585 indicators / 32 subjects, all wordings verified against the NaCCA PDFs (JHS 1,214 of 1,217 from NotebookLM + 31 Mathematics B9 read directly from the PDF; SHS 2,576 of 2,585, 9 flagged). Files in QuizBox/curriculum_verified/. Open: JHS Social Studies (not in notebook), SHS per-document completeness count, validator script, load into the topic registry |
| L12 | Curriculum open items C-2 to C-10 (SHS completeness count, 9 flagged SHS rows, code typos, possibly unextracted indicators): see docs/curriculum/OPEN_ITEMS.md. C-1 Social Studies closed | TODO | Both | L11 | None blocks building the engine |
| L13 | Load the verified curriculum structure into the database: curricula, grade/subject/strand/sub-strand/content-standard/indicator nodes for 3,900+ indicators (JHS 1,302; SHS 2,585). Needs decisions: curriculum codes and versions per level, SHS 1 versus B10 identity | DONE | Both | L11 | Code done: lib/curriculum/structure.ts (all 1,302 + 2,585 indicators get distinct nodes), `qb_curriculum_nodes_import` (20261012110000), screen at /admin/curriculum-structure. Owner steps: register the two curricula, then load each CSV (decision D-16 made) |

## R. SME review pool, ownership and pay
Owner flow 2026-10-10: a loaded batch goes to an SME review pool; any SME whose profile is bound to the subject (or tagged Sponsor reviewer) clicks Pick and owns the question; their work is tracked against their compensation plan. Reuses: domain assignments, review assignments (one open reviewer per question), review events, compensation policy versions, earnings and payout batches. New: the pool view and the Pick action.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| R1 | SME "Review pool" page: what I can pick (by my subject, grade, market, and the Sponsor-reviewer tag), pool size, my fee per review, today's picked / done / earned, my daily limit | DONE | Claude | L5, D7 | `qb_sme_pool` + Review pool card on /review (subject, grade, count, fee and per-100 figure, limits, today's numbers). Questions with no resolvable fee are shown but cannot be picked. Sponsor questions need the SPONSOR specialization on the SME's domain. 12 tests on the real import. NOT applied to any database |
| R2 | Pick action: one click claims 1 or N questions. Claimed items become the SME's assignment. Two SMEs can never take the same question; domain, daily limit and open-queue limit are enforced; the compensation policy version is pinned at pick time | DONE | Claude | R1 | `qb_sme_pick`: reuses `domain_matches` and `resolve_policy`; limits are admin settings `sme_pool.pick_size` (25), `sme_pool.daily_cap` (100), `sme_pool.max_open` (50), `sme_pool.release_hours` (24) in platform_settings; no notification per picked question |
| R3 | My work: owned list, review workbench (exists), release an unfinished item back to the pool (no pay), automatic release of stale claims after N hours | DONE | Claude | R2 | `qb_sme_release` (own work; admin may release any), automatic return runs inside the pool and pick calls (no scheduler needed), admin sweep `qb_sme_pool_sweep`. A returned question is not offered again to the same SME. Admin screen for the four settings comes with R5 |
| R4 | Sponsor-reviewer tag: admin grants an SME a "SPONSOR" domain; sponsor-pool questions carry the same pseudo-subject so the same matching rules apply | IN PROGRESS | Claude | R2, S3 | Pool rule done and tested: a question whose origin is not CURRICULUM is offered only to an SME with a domain whose specialization is SPONSOR (the Specialization field on the Reviewers screen). Remaining: confirm with S3 how sponsor-pool questions carry subject and market |
| R5 | Compensation plan screen: the fee is an admin setting in the compensation policy (nothing hard-coded). Enter it per question with a "per 100 reviews" helper and a daily-earnings calculator, currency, effective dates. Check the market's default SME currency (screens show GHC; the cedi code is GHS) | TODO | Claude | | /admin/compensation exists; fees support 6 decimals and effective dates |
| R6 | Earnings and tracking: daily and weekly counts and earnings per SME (pending QA / payable / paid); admin view per SME, per pool and per batch | TODO | Claude | R3, R5 | Earnings are created per completed review |
| R7 | Quality control on paid work: senior QA samples each SME's reviews (a reversed review earns nothing), minimum review time, seeded known-bad questions to catch rubber-stamping | TODO | Both | R6 | Decision D-12 |
| R8 | Payout batches: approve and mark paid | TODO | Both | R6, D7 | `sme_payout_batches` and items exist |

## T. Topic-based teaching and assignments
Owner design 2026-10-10: teachers teach topics and concepts, not chapters. Each topic has a block of 50 different questions spread over easy, medium and hard, tagged by concept, with explanations that teach. A teacher assigns a topic to students (even absent ones) so they gain understanding of more than half the topic by working through it. A teacher can also pick several topics under a subject; the system spreads the questions evenly (50 questions from 5 topics = 10 from each). Today `qb_publish_assignment` picks at random across all chosen curriculum nodes, with no even spread per topic and no difficulty spread.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| T1 | Topic registry: a record per topic (title, concepts, order, target, linked indicator) and a link from each question to its topic and concept | DONE | Claude | L4 | Migration 20261012100000_topic_registry.sql + rollback written and tested on an isolated PostgreSQL (8 tests); NOT applied to any database. Side tables only; questions table untouched |
| T2 | Loader creates and links topics and concepts; a topic is offered to teachers only when it has enough approved questions (admin setting, default 50); admin readiness view | DONE | Claude | T1, R2 | `qb_question_load` saves each topic with its concepts and links every created question to its topic and concept; activation rule and readiness RPC in the topic registry migration. Teacher-facing offer arrives with T3 |
| T3 | Teacher assignment by topic: pick a subject, tick topics (named in teacher language), choose a total; questions spread evenly across the chosen topics (remainder shared fairly), each topic's share drawn across difficulty levels, no repeats; clear message when a topic cannot supply its share | DONE | Claude | T1, T2 | `qb_teacher_topics`, `qb_topic_assignment_plan` (preview) and `qb_publish_topic_assignment` (20261012140000): equal split, remainder one extra each to the topics with the most questions, 30/40/30 across levels (thin level filled from medium, then easy, then hard), one question per concept before a second, no repeats, a short topic blocks and is named (D-14). Hands the existing publisher MANUAL mode so grading and targets are unchanged. Records `assignment_topics` for T5. Teacher page: /teacher/assignments/by-topic (recipients can be selected learners, e.g. absentees). 10 tests. NOT applied to any database |
| T4 | Topic study mode for students: work through a topic's questions in learning order (easy to hard) with instant feedback and the explanation as a mini-lesson; assignable to absent students; progress per topic | TODO | Claude | T2 | Reuses the practice engine and mastery records |
| T5 | Topic understanding measure: concept-level mastery per student and per topic; "understood" means more than half the topic's concepts mastered | TODO | Both | T4 | Decision D-13 |
| T6 | Teacher view: topic coverage and understanding by class and student; suggest re-assigning topics below the threshold | TODO | Claude | T5 | |

## S. Sponsor process (admin-controlled; sponsors never load or create directly)
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| S1 | Sponsor request form (who, goals, audience, dates, document) and status page | TODO | Claude | A9 | States: SUBMITTED → IN_REVIEW → SOURCE_APPROVED → POOL_LOADING → POOL_VERIFIED → COMPETITION_CONFIGURED → SIGNED_OFF → LIVE → COMPLETED (+ REJECTED, CANCELLED) |
| S2 | Admin requests queue: verify sponsor, confirm content rights, register and approve the document as a source | TODO | Claude | S1 | Reuses source registry approval |
| S3 | Sponsor-scope loading through the same loader (SPONSOR_DOCUMENT origin; document approved first) | TODO | Claude | L4, S2 | `questions.content_origin` already supports it |
| S4 | Pool verification by Sponsor-reviewer SMEs through the review pool (R4) → request moves to POOL_VERIFIED | TODO | Both | S3, R4 | |
| S5 | Admin sets up the competition from a verified pool (rules, dates, eligibility), reusing the competition engine and snapshots | TODO | Claude | S4, F3, F7 | No admin competition setup exists today |
| S6 | Notifications to the sponsor at each stage (incl. sign-off request) and queue alerts to admins | TODO | Claude | S1 | Existing notifications table and bell |
| S7 | Sponsor sign-off, then admin publishes; sponsor sees status and results | TODO | Claude | S5, S6, F5 | Decision D-9 |
---

# STAGE 2: New features (Extension Blueprint v1.0 + 19-artboard design)

Design canvas: https://claude.ai/artifact/8JyB9ENBGKYpV1ZfGmke7n (5 pages, 19 artboards). Each artboard is tracked under the module that builds it. Not started: all rows TODO/DEFERRED.

| ID | Module | Artboards | Status | Who | Depends on | Notes |
|---|---|---|---|---|---|---|
| X0 | Reconnaissance documents: CURRENT_ARCHITECTURE, DOMAIN_MAP, ROUTE_MAP, DATA_FLOW, ADR-001, MIGRATION_PLAN, TEST_MATRIX (blueprint §20.2) + ADRs for roles, tenancy, "campaign" naming clash | | TODO | Claude | Gate 1 (docs only) | No behaviour change |
| X1 | Design-system components as React components in the app (AppShell variants, ChallengeCard, StatePanel, Leaderboard, Stepper, DataTable, StatStrip, Switch, SearchField, Tabs, AlertBanner…) | all (shared) | TODO | Claude | Gate 1 (new files only) | Also upgrades the education screens |
| X2 | Composable roles: Participant capability without an education role; migration backward-compatible with `profiles.role` | ChJoin (sign-up path) | TODO | Both | Gate 2, X0, C7 | Highest-risk change: routing and RLS |
| X3 | Campaign domain: Campaign, ContentAsset/Version, Progression, Participation, versioned question pools, state machine, on the sponsor engine's tables | (backend for all) | TODO | Claude | X2, F3–F7, S5 | Separate schema; reuses scoring engine |
| X4 | Public Challenges: Discover, campaign landing, join + auth return + eligibility, share/QR, noindex rules | ChHome, ChHome390, ChCampaign, ChCampaign390, ChJoin (5) | TODO | Claude | X2, X3, A1 | Anonymous browsing before sign-up |
| X5 | Participant: challenge hub, reader and practice, round result with source evidence | PtHub, PtHub390, PtReader, PtReview (4) | TODO | Claude | X3 | Signed expiring reader links; server-timed rounds |
| X6 | Campaign Studio: campaigns list, 13-step create, structure review, stages/rounds, question pool review, visibility/publish, analytics | StHome, StCreate, StStructure, StRounds, StQuestions, StPublish, StAnalytics (7) | TODO | Claude | X3, L4 | MVP template order: Book → Public policy → Faith |
| X7 | Admin campaign governance: approval, rights, takedowns, integrity flags | AdCampaigns (1) | TODO | Claude | X3 | |
| X8 | Education bridge: "Public challenges" panel, workspace switch, "Just join a challenge" sign-up | EdBridge (1) | TODO | Claude | X2, X4 | Education layout stays unchanged otherwise |
| X9 | Tenancy and white-label: tenant scoping, branding, domain, policies | TnBranding (1) | DEFERRED | Both | X3, a paying customer | Last, per blueprint |
| X10 | Vertical templates: Book, Public policy, Faith presets (config only, no forks) | | TODO | Claude | X6 | One pilot campaign first |
| X11 | Analytics event taxonomy and sponsor/creator dashboards | StAnalytics | TODO | Claude | X3 | |
| X12 | Rewards and commerce (sponsor reward plans; payments only after provider decision) | | DEFERRED | Both | X3, owner decision D-5 | No payment provider today |

---

# Owner decisions needed
| ID | Decision | Needed by | Recommendation |
|---|---|---|---|
| D-1 | AI provider (Google Gemini or Anthropic Claude, or both) and monthly spend cap for question generation | E4/E5 | Build the adapter provider-agnostic (provider and model are env settings), compare both on the same sources; separate Preview and Production keys held only in Vercel; spend cap set first |
| D-2 | Sponsor competitions: enable on production, and the approval rules for sponsors | F8 | Keep "contact us" until F3–F7 pass |
| D-3 | Teacher-managed learner accounts for under-13s | G8 | Yes: it removes the email barrier and the reset problem |
| D-4 | Pilot school and start date | G7 | Choose one school with a willing teacher |
| D-5 | Payment/entry-fee models (jurisdiction and provider) | X12 | Defer until campaigns have users |
| D-6 | SHS2/SHS3 curricula: which source documents | D4 | After D5–D6 are working |
| D-7 | How AI-drafted questions are labelled | L7 | Keep true provenance internally; show learners "Reviewed by subject experts". Do not record AI-drafted items as human-authored |
| D-9 | Sponsor signs off the finished competition before go-live | S7 | Yes: protects both sides |
| D-10 | Review model for loaded questions | L6 | DECIDED 2026-10-10: every question is reviewed by an SME picked from the pool; senior QA samples the SMEs' work (R7) |
| D-11 | Fee per question reviewed and its currency (an admin setting; the figures here are examples only). "10 per 100 reviews" is 0.10 each (10 per day at 100 a day); 1.00 each would be 100 per day | R5 | Owner to confirm the figure; currency code GHS |
| D-13 | What "understanding above 50% of a topic" means | T5 | A concept counts as understood after the student answers at least two of its questions correctly, including one medium or hard; topic understanding = understood concepts divided by the topic's concepts, target more than 50% after one pass |
| D-14 | When a chosen topic can't supply its share of an assignment | T3 | Block the assignment and tell the teacher which topic is short (no silent redistribution) |
| D-16 | Curriculum identity for the extracted documents: JHS Common Core 2020 (B7 to B9) and SHS 2025 curricula as new curricula, and whether SHS year 1 is `SHS 1` or the existing `B10` | L13 | DECIDED 2026-10-10 (owner): both are new curricula (GH-CCP-JHS and GH-SHS-2025), `SHS 1` is the grade, and B10 stays as an alias for the existing 2020 data |
| D-15 | Questions per topic block and the minimum approved before a topic is offered | T2 | 50 per block; both are admin settings |
| D-12 | Daily review cap per SME, hours before an unfinished pick returns to the pool, pick size (admin settings, not fixed in code) | R2, R7 | Cap 100 a day, release after 24 hours, pick 25 at a time, plus QA sampling |
| D-8 | How Gemini is used for bulk drafting: chat on one Pro account within its limits, or the paid API | L2 | Chat for drafting, within the terms of service; API only where automation is needed |

# Change log
- 2026-10-10: engine slice 4: assignment by topic with even spread (T3 done in code; migration 20261012140000 not applied anywhere); teacher page /teacher/assignments/by-topic.
- 2026-10-10: engine slice 3: SME review pool, Pick, release and automatic return (R1, R2, R3 done in code; migration 20261012130000 not applied anywhere).
- 2026-10-10: engine slice 2: question load RPC and batch tracking, admin screen Load questions, curriculum structure loader (L4, L5, L13, T1, T2 done in code; migrations not applied anywhere); D-16 decided.
- 2026-10-10: curriculum structure extractor built (L11): 515 indicators from four official PDFs read directly; source-document defects recorded.
- 2026-10-10: NotebookLM prompts added (source health check, inventory, structure extract, optional fact sheet); L11 added.
- 2026-10-10: engine slice 1: topic registry migration (tested, not applied), verified-curriculum lookup, loading plan, Social Studies extracted (C-1 closed).
- 2026-10-10: trial 2 read by hand; checker gains guessing-cue error (correct option longest in 75%+), implausible-option and LaTeX checks, page check fixed for repeated wording; prompt v3.1.
- 2026-10-10: track T (topic-based teaching and assignments) added; prompt v3 (asks only the level, topic blocks of 50, batches of 100, concept tags); template now 20 columns; checker reports topic blocks.
- 2026-10-10: L3 extended (source verification, rebalancing, curriculum-reference check, 45 tests); prompt v2 after Gemini trial 1; pricing and limits recorded as admin settings.
- 2026-10-10: track R (SME review pool, pick, ownership, pay) added from the owner's flow; L6 and D-10 settled as full SME review of every question.
- 2026-10-10: L3 DONE (loader core and command-line checker; 777 unit tests pass).
- 2026-10-10: one admin-only loading engine (track L) and an admin-controlled sponsor process (track S) replace the earlier bulk-loading and sponsor self-service plans; API generation (E4–E6, E1b) and sponsor generation (F2, F4, F8) deferred; L1 DONE (template and prompts); L2 in progress.
- 2026-10-10: E1 and E3 DONE (Gemini adapter, 742 tests pass); E2 in progress; E4 now waits on the owner's Gemini key and env vars.
- 2026-10-10: D-1 and E1 reworded: provider-agnostic adapter, owner chooses Google or Anthropic.
- 2026-10-10: tracker created. Baseline status taken from the repo, the live site and owner confirmations up to this date.
