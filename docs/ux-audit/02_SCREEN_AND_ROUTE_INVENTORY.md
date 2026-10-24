# 02 - Screen and route inventory

Generated from the repository on 2026-10-24 (branch `ux-audit/2026-10-24-product-experience`, based on `8330718`). 110 page routes and 34 API routes.

**Audit status column.** `BROWSER` = loaded in a real browser at 360/390/768/1440 px with screenshots and axe-core. `CODE` = read in source only (signed-in screens: no test credentials were available, see 03). Signals (client/server, h1, page title) come from a scripted read of the source and are indicative, not a measurement of the running page.

| # | Route | Who sees it | Rendering | Own page title | h1 | Audit status |
|---|---|---|---|---|---|---|
| 1 | `/account` | Any signed-in role | client | no | 1 | CODE |
| 2 | `/admin/access` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 3 | `/admin/challenge-reports` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 4 | `/admin/compensation` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 5 | `/admin/competitions/assignments` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 6 | `/admin/competitions/oversight` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 7 | `/admin/competitions` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 8 | `/admin/content-factory` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 9 | `/admin/content` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 10 | `/admin/curriculum-sources` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 11 | `/admin/curriculum-structure` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 12 | `/admin/exports` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 13 | `/admin/help` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 14 | `/admin/inbox` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 15 | `/admin/market-setup` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 16 | `/admin/marketplace` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 17 | `/admin/markets` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 18 | `/admin/operations` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 19 | `/admin` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 20 | `/admin/payment-checks` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 21 | `/admin/payouts` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 22 | `/admin/policies` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 23 | `/admin/pricing` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 24 | `/admin/quality` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 25 | `/admin/question-batches` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 26 | `/admin/question-loading` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 27 | `/admin/refunds` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 28 | `/admin/reviewer-applications` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 29 | `/admin/reviewers` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 30 | `/admin/sme-performance` | Admin / Owner (+ SME capability pages) | server | no | 1 | CODE |
| 31 | `/admin/sme-workforce` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 32 | `/admin/support` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 33 | `/admin/tickets` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 34 | `/admin/young-learners` | Admin / Owner (+ SME capability pages) | client | no | 1 | CODE |
| 35 | `/competition/[id]` | Student, Teacher, Sponsor, Admin | client | no | 1 | CODE |
| 36 | `/competition/attempt/[id]` | Student, Teacher, Sponsor, Admin | server | no | 0* | CODE |
| 37 | `/competition` | Student, Teacher, Sponsor, Admin | client | no | 1 | CODE |
| 38 | `/competition/participate/[[...id]]` | Student, Teacher, Sponsor, Admin | server | no | 1 | CODE |
| 39 | `/competition/results/[attemptId]` | Student, Teacher, Sponsor, Admin | server | no | 0* | CODE |
| 40 | `/creator/[id]` | Any signed-in role | client | no | 1 | CODE |
| 41 | `/creator/new` | Any signed-in role | client | no | 1 | CODE |
| 42 | `/creator` | Any signed-in role | client | no | 1 | CODE |
| 43 | `/drafts` | Any signed-in role | client | no | 1 | CODE |
| 44 | `/guides/[slug]` | Any signed-in role | client | no | 2 | CODE |
| 45 | `/guides` | Any signed-in role | client | no | 1 | CODE |
| 46 | `/learn` | Student | server | no | 0* | CODE |
| 47 | `/marketplace/[slug]` | Student, Teacher, Sponsor, Admin (flag-gated) | client | no | 1 | CODE |
| 48 | `/marketplace/mine/[id]` | Student, Teacher, Sponsor, Admin (flag-gated) | client | no | 1 | CODE |
| 49 | `/marketplace/mine` | Student, Teacher, Sponsor, Admin (flag-gated) | client | no | 1 | CODE |
| 50 | `/marketplace` | Student, Teacher, Sponsor, Admin (flag-gated) | client | no | 1 | CODE |
| 51 | `/notifications` | Any signed-in role | client | no | 1 | CODE |
| 52 | `/open` | Any signed-in role | server | no | 1 | CODE |
| 53 | `/play/[slug]` | Any signed-in role | client | no | 4 | CODE |
| 54 | `/play/[slug]/read` | Any signed-in role | client | no | 3 | CODE |
| 55 | `/play` | Any signed-in role | client | no | 1 | CODE |
| 56 | `/practise` | Student, Teacher, Admin | client | no | 1 | CODE |
| 57 | `/practise/preview/[id]` | Student, Teacher, Admin | client | no | 1 | CODE |
| 58 | `/review` | SME reviewer / content admin | server | no | 1 | CODE |
| 59 | `/review/policy` | SME reviewer / content admin | server | no | 1 | CODE |
| 60 | `/school/classes` | School admin / teacher | client | no | 2 | CODE |
| 61 | `/school/learners` | School admin / teacher | client | no | 2 | CODE |
| 62 | `/school` | School admin / teacher | client | no | 2 | CODE |
| 63 | `/school/performance` | School admin / teacher | client | no | 3 | CODE |
| 64 | `/school/teachers` | School admin / teacher | client | no | 2 | CODE |
| 65 | `/seller/items/[id]` | Teacher (verified seller) | client | no | 1 | CODE |
| 66 | `/seller/items` | Teacher (verified seller) | client | no | 1 | CODE |
| 67 | `/seller` | Teacher (verified seller) | client | no | 1 | CODE |
| 68 | `/sponsor` | Sponsor | client | no | 1 | CODE |
| 69 | `/sponsor/workspace` | Sponsor | server | no | 1 | CODE |
| 70 | `/student/assessments` | Student | client | no | 1 | CODE |
| 71 | `/student/attempt/[id]` | Student | client | no | 0* | CODE |
| 72 | `/student/classroom` | Student | client | no | 1 | CODE |
| 73 | `/student` | Student | client | no | 1 | CODE |
| 74 | `/student/results/[attemptId]` | Student | client | no | 1 | CODE |
| 75 | `/student/results` | Student | client | no | 1 | CODE |
| 76 | `/subscribe` | Student, Teacher, Admin | client | no | 1 | CODE |
| 77 | `/support/[id]` | Any signed-in role | client | no | 1 | CODE |
| 78 | `/support/new` | Any signed-in role | client | no | 1 | CODE |
| 79 | `/support` | Any signed-in role | client | no | 1 | CODE |
| 80 | `/teacher/assignments/by-topic` | Teacher | client | no | 1 | CODE |
| 81 | `/teacher/assignments` | Teacher | client | no | 1 | CODE |
| 82 | `/teacher/classes` | Teacher | client | no | 1 | CODE |
| 83 | `/teacher/gradebook` | Teacher | client | no | 1 | CODE |
| 84 | `/teacher/learners` | Teacher | client | no | 1 | CODE |
| 85 | `/teacher` | Teacher | client | no | 0* | CODE |
| 86 | `/teacher/question-banks` | Teacher | client | no | 1 | CODE |
| 87 | `/teacher/submissions/[attemptId]` | Teacher | client | no | 1 | CODE |
| 88 | `/challenges/[slug]` | Public (signed out) | server | yes | 0* | CODE |
| 89 | `/challenges` | Public (signed out) | server | yes | 0* | BROWSER |
| 90 | `/competitions/[slug]` | Public (signed out) | server | yes | 0* | CODE |
| 91 | `/competitions` | Public (signed out) | server | yes | 0* | BROWSER |
| 92 | `/contact` | Public (signed out) | server | yes | 1 | BROWSER |
| 93 | `/cookies` | Public (signed out) | server | yes | 0* | BROWSER |
| 94 | `/help/[slug]` | Public (signed out) | server | yes | 1 | BROWSER |
| 95 | `/help` | Public (signed out) | server | yes | 1 | BROWSER |
| 96 | `/join/country` | Public (signed out) | server | yes | 1 | BROWSER |
| 97 | `/join/school` | Public (signed out) | server | yes | 1 | BROWSER |
| 98 | `/join/sme` | Public (signed out) | server | yes | 1 | BROWSER |
| 99 | `/join/sponsor` | Public (signed out) | server | yes | 1 | BROWSER |
| 100 | `/` | Public (signed out) | server | yes | 0* | BROWSER |
| 101 | `/pricing` | Public (signed out) | server | yes | 1 | BROWSER |
| 102 | `/privacy` | Public (signed out) | server | yes | 0* | BROWSER |
| 103 | `/refunds` | Public (signed out) | server | yes | 1 | BROWSER |
| 104 | `/terms` | Public (signed out) | server | yes | 0* | BROWSER |
| 105 | `/auth/callback` | Public (auth) | client | no | 1 | CODE |
| 106 | `/auth/forgot-password` | Public (auth) | client | no | 1 | BROWSER |
| 107 | `/auth/reset-password` | Public (auth) | client | no | 1 | CODE |
| 108 | `/auth/update-password` | Public (auth) | client | no | 1 | CODE |
| 109 | `/login` | Public (auth) | server | no | 0* | BROWSER |
| 110 | `/onboarding` | Any new account | client | no | 0* | CODE |

`0*` = the source scan found no `<h1>`; for public pages the browser run found exactly one on every page tested, because the heading is inside a component the scan did not follow. For signed-in pages the same scan found real gaps, confirmed by reading the files (see register UX-005).

## API routes (34)

| Route | Purpose |
|---|---|
| `/api/admin/content-factory/run` | Run content generation job (admin) |
| `/api/admin/curriculum-sources/fetch` | Fetch a curriculum source (admin) |
| `/api/admin/curriculum-sources/upload` | Upload a curriculum source (admin) |
| `/api/admin/export` | Filtered CSV/Excel export of admin data (permission-grouped) |
| `/api/admin/managed-learners/erase` | Erase a managed (under-13) learner |
| `/api/admin/payment-checks` | Find and settle paid-but-not-recorded payments |
| `/api/admin/policies/extract` | Extract policy text from an upload |
| `/api/challenges/content` | Challenge content |
| `/api/challenges/view` | Count challenge views/shares (per-device budget) |
| `/api/content/media` | Question media upload |
| `/api/cron/drafts` | Scheduled: unfinished-work reminders |
| `/api/cron/managed-erasure` | Scheduled: managed-learner erasure |
| `/api/cron/push` | Scheduled: push notifications |
| `/api/generation/curriculum` | Curriculum generation |
| `/api/help/search` | Public help search |
| `/api/help/track` | Help article analytics |
| `/api/marketplace/checkout` | Start a Marketplace purchase (Paystack) |
| `/api/ops/client-error` | Browser error reports |
| `/api/ops/csp-report` | Content-Security-Policy violation reports |
| `/api/ops/refresh-analytics` | Scheduled analytics refresh (secret-protected) |
| `/api/payments/checkout` | Start a subscription/Coins payment (Paystack) |
| `/api/payments/confirm` | Confirm a payment on return from Paystack |
| `/api/payments/webhook/[provider]` | Paystack webhook (HMAC verified) |
| `/api/public/intake` | Public interest forms (sponsor/school/SME/country) |
| `/api/sponsor/source` | Sponsor source documents |
| `/api/sponsor/workspace` | Sponsor workspace actions |
| `/api/support/contact` | Public contact form |
| `/api/support/delete` | Delete a support attachment/request |
| `/api/support/file` | Serve a support attachment |
| `/api/support/notify` | Support notifications |
| `/api/support/upload` | Support attachment upload |
| `/api/teacher/learners` | Managed young-learner accounts (teacher) |
| `/api/teacher/learners/archive` | Archive a managed learner |
| `/api/teacher/learners/reset` | Reset a managed learner's PIN |
