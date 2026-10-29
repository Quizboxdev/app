# 01 - System and role inventory (baseline)

Audit date: 2026-10-24. Branch: `ux-audit/2026-10-24-product-experience`, created from `8330718` (main, CI green). Nothing in this audit was committed, pushed or deployed.

## 1. Safety record

| Rule | What was done |
|---|---|
| No production data changes | Production (`www.quizbox.io`) was only read: public pages, signed-out redirects. No form was submitted, no account created, no payment started. |
| No destructive tests | None run. The offline and slow-network experiments only changed the local browser. |
| Synthetic data / sandbox credentials | First pass: none supplied. Second pass: logins supplied in `.env.acceptance.local` were tried on the local app against the **Preview** database only; all 7 were rejected, so every signed-in journey stays `BLOCKED` (see 03 section I). They were not tried on production. Parsed credentials were deleted after use. |
| Secrets | None read or recorded. `.env.local` was not opened. |
| Audit branch and baseline | Branch created; baseline below. |

## 2. Technology

| Layer | Facts (from `package.json`, `next.config.ts`, source) |
|---|---|
| Frontend | Next.js 15 App Router, React, plain CSS (`app/globals.css`, `app/(public)/public.css`, `components/pricing/pricing.css`), `lucide-react` icons, `recharts`, `katex` for maths. 76 of 110 pages are client components. |
| Backend | Supabase (Postgres + Auth + RLS). Business rules are SQL functions (`SECURITY DEFINER`, `search_path = ''`); the browser calls RPCs and a few tables. 34 Next.js API routes handle payments, webhooks, uploads, exports, cron. |
| Payments | Paystack (webhook with HMAC, return-page confirm, "Payment checks" admin screen). |
| Hosting | Vercel project `quizbox` (production `www.quizbox.io`); Supabase production `fmgccmqxfjppqydkhaiu`, Preview `fngdtxayfoiffbcbmcum`. |
| Offline | `public/sw.js` service worker registered on production. A previously visited public page loaded with the network off (observed). |
| Tests | 174 test files. Playwright is not a project dependency; `npm run qa:visual` is a custom screenshot script. |
| Docs found | `docs/ux/GLOSSARY.md`, `docs/ui-reference-kit.md`, `docs/beta-testing/NEW_FEATURES_WALKTHROUGH.md`, `docs/roadmap/PROGRESS.md`, `docs/audit/` (security audit register), `docs/uat/`. No `CLAUDE.md` / `AGENTS.md`. |

### Baseline checks (run on the audit branch, 2026-10-24)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, no warnings |
| `npx vitest run` | 168 files passed, 6 skipped; **1,426 tests passed, 119 skipped**, 0 failed (160 s) |
| Last authenticated acceptance run on file | `reports/authenticated-acceptance.json`: 119 passed, 0 failed, on the **Preview** database, 2026-10-19 (before the Marketplace, exports and payment-checks work, so it does not cover them) |

## 3. Roles and permissions (what the code actually has)

Account roles (`qb_role`): `student`, `teacher`, `admin`, `sponsor`; the app also treats `OWNER` as admin. Capability flags on top (read by `getSmeContext`): `reviewer`, `content_admin`, `super_admin`, `finance_admin`, `sme_support`. Schools use `institution_role` (`student`, `teacher`, `admin`, `owner`). Learners under 13 are *managed learners* created by a teacher (no email, no payments).

| Actor | Home route | Menu groups (from `AppShell.tsx`) | Notes |
|---|---|---|---|
| Student | `/student` | Home, Practise, Assignments, Compete, Challenges, My challenges, Create and share; My learning (Progress, Assessments, Marketplace, My question sets); Me (Notifications, Unfinished work, Subscribe, Account) | 7 + 4 + 4 links |
| Teacher | `/teacher` | Teaching (8), Explore (Challenges, Open to join, Competitions, Marketplace, Sell question sets) | Seller menu only for teachers |
| School admin | `/school` (separate menu: Overview, Classes, Teachers, Learners, Performance, Challenges, Competitions) | | Entered through a link; no top-level role |
| Sponsor | `/sponsor` | Dashboard, Unfinished work, Workspace (flag), Challenges, Competitions, Marketplace | |
| SME reviewer | `/review` | "SME" group appears for anyone with the reviewer/content-admin/super-admin capability | A capability, not an account type |
| Admin / Owner | `/admin` | Up to 7 groups and up to 39 links depending on capability | See 05 |
| Finance admin / support | Admin links filtered by capability | | Capability-filtered menu and API permission groups |

Authorization layers: (1) RLS and RPC checks in Postgres (authoritative); (2) `AppShell` allow-list redirect in the browser (convenience only); (3) optional edge guard `QB_SERVER_GUARD` (built, **off** in production). Observed on production: signed-out `/admin`, `/teacher`, `/marketplace` return HTTP 200 and show "Loading your workspace..." for 1.2-2.5 s before the browser redirects to `/login` (see register UX-020).

## 4. Feature status

| Status | Features |
|---|---|
| Implemented and live | Public site, sign-up/onboarding, student practice and assessments, teacher classes/assignments/gradebook, challenges, competitions, subscriptions and Coins (Paystack), help centre, support requests, policies and acceptance, admin exports (31 datasets), payment checks |
| Implemented, switched off by flag | Marketplace (`flags.marketplace`), seat limits for challenges, paid challenges, sponsor engine, server-side sign-in guard |
| Partial / pilot | Content volume (1,225 approved questions, 0 Primary), school and sponsor payers (planned), automatic payouts (manual by finance) |
| Placeholders found | None seen on public pages; public stat tiles show real figures including zeros (see register UX-008) |

## 5. Environments

| Environment | Use in this audit |
|---|---|
| Production `www.quizbox.io` | Read-only public pages, signed-out redirects |
| Vercel Preview + Supabase Preview | Not used (no URL or credentials supplied; the Preview environment variables are known to need fixing) |
| Local `next dev` | First pass: not started (`.env.local` points at production). Second pass: started on port 3100 with the Preview database values from `.env.acceptance.local` and the production service-role, Paystack and Resend keys replaced by dummies (`docs/ux-audit/tools/`); the built JavaScript was checked to contain the Preview project reference and not the production one. Stopped after use |
