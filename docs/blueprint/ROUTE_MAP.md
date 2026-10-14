# Route map (confirmed from app/**/page.tsx)

| Group | Routes | Access |
|---|---|---|
| Public | `/`, `/contact`, `/join/{sponsor,sme,school,country}`, `/privacy`, `/terms` | anonymous |
| Auth | `/login`, `/auth/{callback,forgot-password,reset-password,update-password}`, `/onboarding` | anonymous or signed in |
| Learner | `/student`, `/student/{assessments,attempt/[id],results,results/[attemptId],classroom}`, `/practise`, `/learn` (redirects to /practise), `/subscribe` | student (allow-list in AppShell) |
| Teacher | `/teacher`, `/teacher/{classes,assignments,assignments/by-topic,question-banks,gradebook,submissions/[attemptId]}`, `/practise` | teacher |
| School | `/school`, `/school/{classes,teachers,learners,performance}` | school admin |
| Competition | `/competition`, `/competition/[id]`, `/competition/participate/[[...id]]`, `/competition/attempt/[id]`, `/competition/results/[attemptId]` | signed in |
| Sponsor | `/sponsor`, `/sponsor/workspace` | sponsor (creation OFF in production) |
| Reviewer | `/review`, `/review/policy` | reviewer capability |
| Market | `/seller`, `/marketplace`, `/admin/marketplace` | seller or any signed-in |
| Admin | `/admin` plus markets, market-setup, curriculum-sources, curriculum-structure, question-loading, content, content-factory, quality, reviewers, sme-performance, sme-workforce, compensation, payouts, competitions (assignments, oversight), operations, support, marketplace | admin or owner with capability |
| API | `app/api/{admin,content,generation,ops,sponsor}` | server |
| SEO | `app/sitemap.ts`, `app/robots.ts` | public |

## Missing for Challenges (blueprint 6 and 17)
`/challenges`, a campaign landing page by slug, search, share and QR, and studio routes. **UNKNOWN:** whether Challenges is a subdomain (blueprint: challenges.quizbox.com) or a path on this app (ADR-003). A subdomain needs Vercel domain and Supabase auth-redirect configuration that is not present.
