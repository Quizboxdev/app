# Role and permission matrix

Derived from `components/AppShell.tsx` (route allow-list and sidebar) on 2026-10-21. This shows what each role's **interface** offers. The authoritative enforcement is in the database (RLS and RPC checks); the matrix of server-side rules was reviewed statically and not exercised with live accounts (BLOCKED).

Route allow-list (the first column is the path prefix)

| Prefix | Student | Teacher | Sponsor | Admin / Owner | Notes |
|---|---|---|---|---|---|
| /student, /learn | yes | | | | |
| /teacher | | yes | | yes | |
| /sponsor | | | yes | | |
| /admin | | | | yes (sub-pages by SME capability) | `/admin/markets`, `reviewers`, `compensation` need super_admin; `inbox`, `reviewer-applications` need super_admin or sme_support; `sme-performance`, `payouts` need super_admin or finance_admin |
| /practise | yes | yes | | yes | |
| /competition | yes | yes | yes | yes | |
| /creator | yes | yes | yes | yes | Students limited to curriculum questions, link-only, no prizes/logo/material (DB triggers) |
| /open (new) | yes | yes | yes | yes | Fixed on audit branch (QB-AUD-001); was blocked in the deployed build |
| /marketplace | yes | yes | yes | yes | |
| /subscribe | yes | yes | | yes | Minors cannot pay online |
| /seller | | seller flag | | seller flag | |
| /review | reviewer / content_admin / super_admin (any base role) | | | | |
| /account, /notifications, /school, /play, /drafts | all | all | all | all | `/school` pages are for school administrators |

Capabilities layered on a base role: `reviewer`, `content_admin`, `sme_support`, `finance_admin`, `super_admin` (from `user_capabilities`).

Verification status: UI allow-list PASS (read); automated guard `components/appshell-nav.test.ts` ensures no nav link points outside the allow-list; server-side enforcement per role UNVERIFIED live.
