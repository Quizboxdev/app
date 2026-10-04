# Security release review (preview branch `fngdtxayfoiffbcbmcum`)

Evidence: Supabase Security Advisor run on the data-cloned branch after migrations
`20261002200000`–`20261002270000`; catalog queries for grants and function bodies;
isolated PostgreSQL tests; browser acceptance. Production (`fmgccmqxfjppqydkhaiu`) not touched.

## Advisor result

| Finding | Level | Count | Change vs pre-fix branch run |
| --- | --- | --- | --- |
| authenticated_security_definer_function_executable | WARN | 95 | unchanged |
| rls_enabled_no_policy | INFO | 47 | unchanged (private tables, deny-by-default by design) |
| anon_security_definer_function_executable | WARN | 1 | unchanged (`qb_marketplace_catalog`) |
| auth_leaked_password_protection | WARN | 1 | unchanged |
| Any ERROR | — | 0 | — |

No new finding types relative to the stored live baseline (`reports/live-security-advisors.json`).

## Classification

### P0 — release blocking
None open.

### P1 — fix before or with production activation
| Item | Status |
| --- | --- |
| Sponsor members could call `assign_candidate` and choose reviewers for their own candidates (migration 6 path skipped the content-admin check present in migration 5). | **Fixed** in `20261002270000`: `assign_candidate`, `assignment_queue` and `eligible_reviewers` require `content_admin` (OWNER/`super_admin` included). Test: sponsor receives `QB_SME_ASSIGNMENT_DENIED`. |
| Migration 6 blanket revoke removed `authenticated` execute on `quizbox_competition.storage_access`, breaking the private source-bucket policies. | **Fixed** in `20261002250000` (grant restored). Test asserts the grant. |
| Leaked-password protection disabled. | **Open — dashboard action** (Auth > Attack Protection). Checklist step 4. |
| Leaderboard and sponsor analytics exposed other participants' profile UUIDs. | **Fixed** in `20261002270000`: display label (first name + last initial, fallback `Participant N`), `is_you` flag; ids removed. |

### P2 — accepted / monitor
| Item | Assessment |
| --- | --- |
| `qb_marketplace_catalog()` executable by `anon` | Intentional public catalogue; read-only, published/approved products only. Accept. |
| `qb_signup_markets()` executable by `anon` | Intentional public contract (grant in `20261003100000_multi_market_platform.sql`): read-only list of active countries and ACTIVE non-test markets with display configuration, used by country-first signup and the public homepage (which renders display labels only). Accept. Explicitly allowlisted in `lib/operations/public-rpc-allowlist.ts`, which `scripts/security-readiness.ts` uses; no wildcard. |
| 47 tables with RLS and no policy | All private workflow tables (`quizbox_competition.*`, ledger/attribution tables); access only through SECURITY DEFINER RPCs. Accept. |
| `qb_settle_paid_order` | Requires platform admin or `FINANCE_MANAGE`; assumes an external trusted payment confirmation. No client caller. Keep; revisit when payments go live. |
| 14 helper functions in `quizbox_market`/`quizbox_sme` executable by authenticated | Predicates used inside RLS policies and RPCs (e.g. `is_super`, `market_allowed`, `has_capability`). Return booleans about the caller only. Accept. |

## SECURITY DEFINER functions reachable by `authenticated` (95, schema `public`)

* **Intentionally client callable (73):** called by the app (`lib/api`, `app`, `components`) and each body checks `auth.uid()` and/or a role/permission helper. Examples: `qb_start_attempt`, `qb_save_response`, `qb_complete_attempt`, `qb_get_result`, `qb_content_*`, `qb_sme_*`, `qb_market_configure`, `qb_admin_*` (platform-admin checks), `qb_publish_assignment`, `qb_list_available_assessments`, `qb_marketplace_catalog`, competition/team RPCs.
* **Required by RLS policies (11):** `qb_is_platform_admin`, `qb_is_tenant_member`, `qb_is_class_member`, `qb_can_manage_class|institution|tenant`, `qb_controls_seller`, `qb_current_student_id`, `qb_has_permission`, `qb_public_tenant_id`, `qb_question_is_available`. Must stay executable.
* **Internal helpers also callable (7):** `qb_can_access_learning_assessment`, `qb_create_content_context`, `qb_is_acceptance_actor`, `qb_tenant_role`, `qb_sme_assign_review|complete_review|review_detail` (wrapped by the sponsor dispatcher). They enforce their own caller checks; candidates for a later grant clean-up, not a release blocker.
* **No app caller found (4, uncertain):** `qb_settle_paid_order` (see P2), `qb_submit_attempt` (rate-limited wrapper; core checks attempt ownership via `auth.uid()`), `qb_create_marketplace_order` (requires auth, published/approved product only), `qb_get_daily_metrics` (role check present). Left as is; review when the owning features are removed or activated.

No functions were mass-revoked.

## Competition RPC surface

`quizbox_competition` functions executable by `authenticated`: exactly `dispatch`, `storage_access`,
`raw_question_allowed`. `dispatch_delivery`, `dispatch_review_bridge`, `participant_label` and all
helpers are not executable by API roles. Public entry point remains `public.qb_sponsor_workspace`
(SECURITY INVOKER) → `dispatch`.

## Isolation evidence (branch + isolated tests)

| Control | Evidence |
| --- | --- |
| Cross-sponsor | Teacher/student/seller → `SPONSOR_ACCESS_DENIED` on organization, drafts, documents, analytics. |
| Cross-market | Legacy attribution test: Nigeria-attributed content denied to a Ghana member; market predicates unchanged. |
| SME scope | Out-of-domain reviewer → `QB_REVIEW_ACCESS_DENIED`; revoked market membership → `QB_REVIEW_DOMAIN_DENIED`. |
| Participant results | Client update of `assessment_results` → permission denied; resubmission idempotent (one official result); answers after submit → `QB_ATTEMPT_NOT_ACTIVE`; attempt limit enforced. |
| Frozen content | Sponsor question / snapshot rows not writable by clients; draft edit after publication → `COMPETITION_FROZEN`. |
| Admin capability | ADMIN without `super_admin` denied on market/SME configuration; `super_admin` granted only through the documented SQL bootstrap. |
| Production gate | `local-gate.ts` hard-blocks `fmgccmqxfjppqydkhaiu` and `QB_PRODUCTION_PROJECT_REF`; requires the exact named branch host over https (unit tests). |

## Multi-country phase addendum (2026-10-03)

New RPCs and their guards: `qb_signup_markets` (anon; lists countries and ACTIVE non-test markets only),
`qb_complete_onboarding` (once per account; roles student/teacher/sponsor only; SME is a pending
application with no review access), `qb_my_account` / `qb_request_market_change` (own data only),
`qb_set_assignment_grade_override` (owning teacher, reason required, audit row), `qb_market_admin` and
`qb_market_setup` (Super Admin only; activation gated by readiness and approved sources).

Pre-existing defects found by the multi-country acceptance and fixed (all P1, none exploitable for access):
| Defect | Effect | Fix |
| --- | --- | --- |
| `sme_review_queue` (security_invoker) called non-executable `quizbox_sme.domain_matches` | Legacy SME queue failed for everyone | `20261003160000` grants execute on the predicate |
| Injected market guard aliased `w` inside functions declaring variable `w` | `qb_sme_review_detail` / `qb_sme_complete_review` always failed | Source `210000` corrected; `20261003180000` repairs installed copies |
| `market_class_read` looked the class up by id | Every class INSERT … RETURNING failed | `20261003190000` evaluates the row's own columns |
| Signup trigger required a national grade; audit actor FK | Country-first signup impossible | `20261003110000` |
| Attribution only at migration time | New markets' content could never be served | `20261003170000` continuous, deterministic attribution |
| Self-serve (tenant-less) classes failed the tenant clause | New teachers' students could not see assignments | `20261003200000` treats null tenant as public; market checks unchanged |

Release fixtures: `DEV_ACCEPTANCE_FIXTURE` questions are now denied by `question_allowed` to everyone except
the reserved acceptance identities (in addition to the existing assessment-level gate).

## Privacy and access-control audit (operations phase, 2026-10-03)

| Boundary | Control | Evidence |
| --- | --- | --- |
| Student PII | Leaderboards, sponsor analytics and ranking summaries carry display labels (first name + last initial, `Participant N` fallback); no email, phone or profile id. Market shown only for multi-market/global scopes; school only when the sponsor opts in (`leaderboardShowInstitution`). | Branch leaderboard `Tia L.` / `Kofi A.` with market; `source-delivery.test.ts` asserts no ids. |
| Sponsors | Workspace, analytics, readiness, eligibility (aggregate counts by market only), comparison and published-version views require organization membership. | Cross-sponsor probe → `SPONSOR_ACCESS_DENIED`. |
| SMEs | Review detail returns the question, cited source excerpt and provenance only; queue and search show own assignments only. | `qb_search` SME branch filters `reviewer_id = auth.uid()`. |
| Teachers | Classes, submissions, insights and indicator summaries are limited to classes they teach (RLS + `teacher_user_id`). | Teacher insights and home queries filter by `teacher_user_id`. |
| Market admins | Market configuration, readiness, source approval and curriculum activation require explicit `super_admin`; ADMIN alone cannot configure markets. | `qb_market_admin` / `qb_market_setup` → `SUPER_ADMIN_REQUIRED`. |
| School admins | `qb_school` requires an active admin/owner membership of that institution; transfers stay within the institution. | `platform-ops.test.ts`. |
| Super Admin auditability | Every `qb_admin_ops` call (including lookups), market status changes, source approvals, curriculum activation, quality flags/resolutions, school actions and competition close/archive write `audit_logs`; the trail is searchable in Admin › Operations. | `platform-ops.test.ts` audit assertions. |
| Notifications | Rows readable/updatable only by the recipient (`notifications_self`); live alerts computed per caller; admin alerts only for content/super admins. | `platform-ops.test.ts`. |
| Observability | Client failure codes are reduced to canonical upper-case codes (free text dropped); anonymous auth failures store only a short code, rate-capped. | `lib/operations` tests; `qb_auth_failure`. |

## Content Factory and SME workforce addendum (20261005100000)

| Control | Enforcement | Evidence |
|---|---|---|
| Factory access | `qb_content_factory` / `qb_content_factory_import` require `content_admin` (or super admin); campaigns are visible only in markets the caller may access. | `campaign.test.ts` (market isolation); branch API check: student, sponsor, SME denied. |
| No parallel engine | Questions enter only through `core_qb_content_ingest` under a validated LOCAL_MARKET / CURRICULUM_ALIGNED context; provider identity and external IDs are assigned server-side; nothing is auto-approved or published. | `campaign.test.ts`; branch demo (100 in review, 0 active). |
| Country isolation | Campaign market and curriculum are immutable; sources must be approved CURRICULUM documents of that curriculum and market; generation is refused unless the caller's active market is the campaign's. | `campaign.test.ts`. |
| Runaway generation | One click = at most 10 provider calls; claims are budgeted; retries are bounded; campaigns auto-pause on consecutive failures; large campaigns need a typed confirmation; at most 20,000 jobs. | `campaign.test.ts`. |
| Workload authorization | Policies must lie inside an active reviewer domain (super admin only); the scheduler assigns only via `qb_sme_assign_review` (domain match + compensation policy). | `campaign.test.ts`; branch: 0 off-subject assignments. |
| Assignment is not payment | Released assignments close without review events; earnings come only from `qb_sme_complete_review`; assignment and policy history is append-only (`QB_IMMUTABLE_HISTORY`). | `campaign.test.ts` (reassign, immutable events). |
| Data exposure | `quizbox_factory` schema and tables have no client grants; only the three public RPCs are granted to `authenticated`. | Migration grants. |
