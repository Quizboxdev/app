# QuizBox

Curriculum-aligned learning, assessment and competition for Primary, JHS and SHS learners in Ghana (built to add other countries). Live at https://www.quizbox.io.
Learners practise and take assessments, teachers set and mark work, schools see results, sponsors run challenges and competitions, subject experts review the questions, and staff run it all from admin screens.

**Start here, in this order**
1. `docs/DILIGENCE_OVERVIEW.md`: architecture, data flow, payment flow, security controls and the open risks, on one page.
2. `CONTRIBUTING.md`: how to run it, how to make a change, what needs the owner's approval.
3. `docs/release/RELEASE_MANIFEST_2026-10-24.md` and `docs/release/COPY_LIST.ps1`: how a release reaches the two databases and the website.
4. `docs/ops/INCIDENT_RUNBOOK.md`: what to do when something breaks.
5. `docs/roadmap/PROGRESS.md`: what is done and what is next. `docs/ux-audit/`: the product-experience audit and its register.

## Technology

| Part | What it is |
|---|---|
| Website and API | Next.js 15 (App Router), React 19, TypeScript (strict), plain CSS with design tokens in `app/globals.css` |
| Data, sign-in, files | Supabase: Postgres with row-level security, Auth, Storage. Business rules are SQL functions called by the browser or the API routes |
| Payments | Paystack (mobile money and cards) through `app/api/payments/*` and `app/api/marketplace/*` |
| Hosting | Vercel (`main` deploys to www.quizbox.io); two Supabase projects: Production and Preview |
| Quality gates | GitHub Actions (`.github/workflows/ci.yml`): type check, lint, about 1,460 tests (database tests run on a real Postgres engine), production build, dependency advisory check |

## Run it on your computer

```powershell
npm ci
copy .env.example .env.local     # then fill in the values for a NON-production Supabase project
npm run dev                      # http://localhost:3000
```

**Never put production keys in `.env.local` for everyday work.** Use the Preview project. `.env.*` files are ignored by git; keep it that way.

| Command | What it does |
|---|---|
| `npx tsc --noEmit` | type check |
| `npx eslint .` | lint |
| `npx vitest run` | all tests (about 3 minutes) |
| `npm run build` | production build |
| `python scripts/release/make_release_kit.py` | rebuild the paste-ready SQL parts and the database fingerprint after changing a migration |

## Where things are

| Folder | Contents |
|---|---|
| `app/` | Pages and API routes. `(public)` = signed-out site, `(app)` = signed-in screens by role (`student`, `teacher`, `school`, `sponsor`, `review`, `admin`, ...), `api/` = server routes |
| `components/` | Shared screens parts (shell, error panel, price cards, public site sections) |
| `lib/` | Business logic and the typed API layer (`lib/api/*` calls the database), payments (`lib/payments`), exports (`lib/exports`), security helpers |
| `supabase/migrations/` | The database, in order. `supabase/rollback/` undoes the newer ones |
| `scripts/` | Release, content-loading and acceptance tooling |
| `docs/` | Everything written down. `docs/release/` has the apply guides and the copy lists |
| `middleware.ts` | Challenge-host redirect, the home-page session hand-off, policy-version rewrite, and the optional server-side sign-in guard |

## Environments

| | Website | Database |
|---|---|---|
| Production | www.quizbox.io (Vercel, branch `main`) | Supabase project `fmgccmqxfjppqydkhaiu` |
| Preview | Vercel preview URLs for other branches | Supabase project `fngdtxayfoiffbcbmcum` |

Every environment variable the code reads is listed, with its purpose, in `.env.example`.

## Who to ask

The product owner is Ransford Mensah (QuizBox Solutions, Ghana). Security reports: see `SECURITY.md`. Licence: proprietary, see `LICENSE`.
