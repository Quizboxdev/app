# QuizBox roadmap and progress tracker

Single source of truth for "where are we". Updated whenever an item changes. When the owner asks for status, report every row grouped by status, with counts.

Created 2026-10-10. Last updated 2026-10-10.

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

- **Gate 1, core ready for a pilot:** every A, B, C, D row DONE, E1–E5 DONE, G1–G6 DONE.
- **Gate 2, Stage 1 complete:** Gate 1, plus every F row DONE (or F8 explicitly DEFERRED by the owner), plus G7 (pilot) passed with no P0/P1 defects.
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
| E1 | Adapter service: same-app server route; provider selected by env (Anthropic Claude and Google Gemini both supported). No new infrastructure | TODO | Claude | | Reads the contract above; key stays server-side |
| E2 | Source-grounded prompt, schema validation, exact-count enforcement, evidence kept on every candidate | TODO | Claude | E1 | Reuses existing ingest validation and duplicate checks |
| E3 | Tests: mocked provider, contract test against `configuredFactoryProvider` / `generateQuestions`, failure and timeout paths | TODO | Claude | E1, E2 | |
| E4 | Preview run: small campaign (one indicator, ~5 questions) from generation → review → publish | TODO | Both | E3, C7 | Needs Anthropic key in the Preview environment |
| E5 | Production enablement: key in Vercel, small controlled campaign, human review | BLOCKED | Owner | E4, D6 | Owner provides the key and spend limit |
| E6 | Cost and rate controls (`tokens_per_question`, per-campaign caps, kill switch) | TODO | Claude | E1 | |

## F. Sponsor competition engine (built, gated off)
Status per docs/sponsor-competition-activation.md: built and tested on local fixtures; not release-ready.
| ID | Item | Status | Who | Depends on | Evidence / notes |
|---|---|---|---|---|---|
| F1 | Domain model, migrations, workspace, upload/extract, candidates, review bridge, snapshots, delivery, results (fixtures) | DONE | Claude | | lib/competition/*, 6 sponsor migrations |
| F2 | Generation for sponsors uses the same adapter (sponsor contract `{input, chunks}`) | TODO | Claude | E1 | |
| F3 | Browser acceptance of the full flow on a Preview branch | TODO | Claude | E4 | Create → generate → review → publish → participate → results |
| F4 | Background scheduling for extraction and generation | TODO | Claude | E1 | |
| F5 | Aggregate analytics across competitions | TODO | Claude | F3 | |
| F6 | Leaderboard display names (privacy rules for minors) | TODO | Claude | F3 | |
| F7 | Balanced publication (difficulty/topic) and oversight UI completed | TODO | Claude | F3 | |
| F8 | Production enablement: decision + change to the gate that forbids the production project | BLOCKED | Owner | F3–F7, C2 | `lib/competition/local-gate.ts` never enables the engine on production |
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

---

# STAGE 2: New features (Extension Blueprint v1.0 + 19-artboard design)

Design canvas: https://claude.ai/artifact/8JyB9ENBGKYpV1ZfGmke7n (5 pages, 19 artboards). Each artboard is tracked under the module that builds it. Not started: all rows TODO/DEFERRED.

| ID | Module | Artboards | Status | Who | Depends on | Notes |
|---|---|---|---|---|---|---|
| X0 | Reconnaissance documents: CURRENT_ARCHITECTURE, DOMAIN_MAP, ROUTE_MAP, DATA_FLOW, ADR-001, MIGRATION_PLAN, TEST_MATRIX (blueprint §20.2) + ADRs for roles, tenancy, "campaign" naming clash | | TODO | Claude | Gate 1 (docs only) | No behaviour change |
| X1 | Design-system components as React components in the app (AppShell variants, ChallengeCard, StatePanel, Leaderboard, Stepper, DataTable, StatStrip, Switch, SearchField, Tabs, AlertBanner…) | all (shared) | TODO | Claude | Gate 1 (new files only) | Also upgrades the education screens |
| X2 | Composable roles: Participant capability without an education role; migration backward-compatible with `profiles.role` | ChJoin (sign-up path) | TODO | Both | Gate 2, X0, C7 | Highest-risk change: routing and RLS |
| X3 | Campaign domain: Campaign, ContentAsset/Version, Progression, Participation, versioned question pools, state machine, on the sponsor engine's tables | (backend for all) | TODO | Claude | X2, F3–F7, E | Separate schema; reuses scoring engine |
| X4 | Public Challenges: Discover, campaign landing, join + auth return + eligibility, share/QR, noindex rules | ChHome, ChHome390, ChCampaign, ChCampaign390, ChJoin (5) | TODO | Claude | X2, X3, A1 | Anonymous browsing before sign-up |
| X5 | Participant: challenge hub, reader and practice, round result with source evidence | PtHub, PtHub390, PtReader, PtReview (4) | TODO | Claude | X3 | Signed expiring reader links; server-timed rounds |
| X6 | Campaign Studio: campaigns list, 13-step create, structure review, stages/rounds, question pool review, visibility/publish, analytics | StHome, StCreate, StStructure, StRounds, StQuestions, StPublish, StAnalytics (7) | TODO | Claude | X3, E1 | MVP template order: Book → Public policy → Faith |
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

# Change log
- 2026-10-10: D-1 and E1 reworded: provider-agnostic adapter, owner chooses Google or Anthropic.
- 2026-10-10: tracker created. Baseline status taken from the repo, the live site and owner confirmations up to this date.
