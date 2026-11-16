# Family RBAC and Academic Parent workspace: implementation map (Phase 0)

Status: audit only. No code, schema or behaviour changed by this document. Written 2026-11-16 from the repository at `main`.
Governing rule from the directive: **extend QuizBox, do not fork it.** Every item below names the existing piece that will be reused.

## 1. What already exists (and will be reused)

| Directive area | Existing implementation | Verdict |
|---|---|---|
| Authentication / sessions | Supabase Auth; `bootstrapUser`, `getHomeRouteForRole` in `lib/auth.ts`; onboarding at `app/onboarding` (`qb_complete_onboarding`) | Reuse. Add a home route for the new role. Do not touch sign-in. |
| Roles | `profiles.role` is the enum `qb_role` (`student, teacher, admin, sponsor`) in `20260926180457_initial_quizbox_jhs_schema.sql`. One role per profile. `public.user_capabilities` (staff capabilities, CHECK-limited list) and `quizbox_core.is_staff()` | Single-role today. See decision D1. |
| **Parent ↔ student relationship** | **`public.account_relationships`** (`20261007100000_core_platform_foundation.sql`): `source_user_id` (guardian/sponsor) → `target_user_id` (ward), types `guardian, sponsor, institutional`, statuses `requested, pending_verification, active, suspended, revoked`, flags `can_fund, can_view_progress, can_manage_account`, consent, validity window, staff verification. Functions `quizbox_core.relationship_allows(source, target, perm)`, `qb_relationship_allows`, `qb_relationship_request`, `qb_relationship_decide` | **This is the directive's `parent_student_relationship`.** Extend it; do not create a second table. |
| Student accounts | `profiles` + `student_profiles` (`managed_by`, `is_minor`, `school_name`, `subjects`, `grade_code`) | Reuse. A child is an ordinary student profile. |
| **Account creation without public sign-up** | Teacher-managed learners (`20261019150000_managed_learners.sql`): server route creates an auth user with a generated username and password using the service role; `qb_managed_learner_provision`, list, archive, password reset; consent record; blocked features for under-13 (`qb_feature_allowed`); `lib/api/managed.ts`, `app/api/teacher/learners*` | **Reuse the pattern** for "Add child" (new routes, same provisioning style). |
| Teacher / school links | `classes`, `class_memberships`, `teacher_profiles`; student school is `student_profiles.school_name` plus the new school directory | Untouched. Family is additive. |
| Assignments | `assignments` (needs `class_id`, `teacher_id` → `teacher_profiles`, `teacher_user_id`), `assignment_targets` (per student, per class membership), `attempts`, assessments and question banks, reminders, schedules | **Cannot be reused as is** for parents. See decision D2. |
| Challenges | `challenge_campaigns` (`owner_id`, `visibility PRIVATE` with access code, `question_count`, `max_attempts`, `reward_text`, `starts_at/ends_at`), `challenge_questions`, attempts, `lib/api/challenges.ts` | Good fit: a parent is an `owner_id`. Needs a "target children" link (D3). |
| Marketplace | `mk_items`, `mk_purchases` (`buyer_user_id`, 12-month expiry, reversal), `mk_attempts`, `app/api/marketplace/checkout` | Reuse. Parent is the buyer; library = their active purchases. |
| Coins / wallet | `wallets` (per user, purchased and promotional buckets), **immutable ledger** `coin_transactions` (idempotency key, `balance_after`), `qb_coin_spend`, `quizbox_core.ensure_wallet` | Reuse as is. Child wallet is the existing student wallet. |
| **Buying for someone else** | `payment_intents` already has `payer_user_id` and `beneficiary_user_id`; `qb_payment_intent_create` allows a payer who is not the beneficiary only when `relationship_allows(payer, beneficiary, 'can_fund')`; `app/api/payments/checkout` already accepts `beneficiary`; signed webhook, `payment_events`, `qb_payment_apply_event`, reconciliation, idempotency | **Buy coins for a child already works** at the database and API level. Missing: the parent UI, and a multi-child order. |
| **Subscriptions** | `learner_subscriptions`; `qb_fulfil_subscription_payment` already credits the **beneficiary** and records the payer; `config/subscription-plans.json` (monthly, term; no weekly/yearly yet) | Reuse. Weekly and yearly are a config change, not new tables. |
| Notifications | `notifications` (`recipient_user_id`, `recipient_role` is `qb_role`, `type`, `entity_*`), push subscriptions | Reuse; `recipient_role` is tied to the enum (D1). |
| Progress / analytics | Student dashboard and progress RPCs (`lib/api/student.ts`), teacher analytics | Reuse behind `can_view_progress`. |
| Admin pages | `/admin/*` analytics kit (`components/admin/DataViz`) | `/admin/families` follows the same kit. |
| Audit | `public.audit_logs`, `quizbox_core.audit(...)` | Reuse for every privileged family action. |
| Service layer | Browser RPC wrappers in `lib/api/*.ts`; server routes in `app/api/*` for service-role work | Follow the same split. |

## 2. Gaps the directive needs, mapped to the smallest extension

1. **A `PARENT` role.** Do not add a second profile or fork. See D1.
2. **Family workspace.** New table `family_workspaces` (owner, name) plus the existing relationships as membership. Small.
3. **Relationship types and permissions.** Extend `account_relationships`: allow types `parent, mentor, academic_parent` (the CHECK is a list), add a `permissions jsonb` (or boolean columns) for assign, buy questions, buy coins, buy subscription, view progress, manage access. Keep the existing three flags working.
4. **Verification rule.** Today `status = 'active'` requires `verified_by` (staff). A parent who creates the child account must not wait for staff. Rule: relationships created by the provisioning route are `active` with consent recorded; a link to an **existing** student stays `pending` until that student (or staff) accepts.
5. **Child access link.** Reuse the managed-learner credential approach, but with a single-use invitation token. New table `family_invitations` storing only a **hash** of a random token, expiry, used-at, revoked-at. Resolves to the normal session (never a bearer credential).
6. **Parent-created assignments** (D2) and **challenge targeting** (D3).
7. **Source/provenance** on student work: `source_type`, `source_id`, `assigned_by`, `workspace_id` (add to the assignment/challenge target records, default `school`).
8. **Family library** = a view over the parent's active `mk_purchases`, plus an "assign" action. No duplicated question data.
9. **Multi-child orders.** `payment_intents` is one beneficiary per row. For "all children" create one intent per child under a shared `order_ref` in `metadata`, settled together. Needs a thin `family_orders` table to make "atomic" real (see D4).
10. **Family notifications and the unified student feed filter** (All / School / Family / Challenges / Completed).
11. **`/admin/families`.**

## 3. Decisions needed from the owner before Phase 1 and Phase 4

- **D1. How a user becomes a Parent.** Options: (a) add `parent` to `qb_role` (touches `getHomeRouteForRole`, `notifications.recipient_role`, RLS that switches on role; one role per profile, so a teacher who is also a parent cannot have both); (b) **recommended**: keep `qb_role` as is, treat "parent" as a capability derived from owning a `family_workspace`, and let any adult account (student excluded) open one. This gives multi-role for free (a teacher can be a parent) and does not disturb existing role checks. Sign-up gets a "Parent" choice that creates a teacher-free, sponsor-like profile role plus the workspace.
- **D2. Parent assignments.** `assignments` requires a class and a teacher profile. Options: (a) **recommended**: a hidden per-family "family class" owned by the parent (with a lightweight `teacher_profiles` row), so the existing assignment, targets, attempts, scoring and reminders all work unchanged, and school classes are never touched; (b) make `class_id` and `teacher_id` nullable (invasive, risks every teacher query). (a) is a schema-light, regression-safe route.
- **D3. Challenges for specific children.** `challenge_campaigns` are public/unlisted/private by access code. Add a `challenge_invites` (campaign, student) link and show invited work in the student feed.
- **D4. "Buy for all children."** Directive recommends **amount per child**. Atomicity: all intents are created in one database transaction under one order; the checkout is one Paystack charge for the total; settlement credits every child or none. Needs one new order table.
- **D5. Under-13 children.** Existing rules block some features (paid challenges, chat, public leaderboards). A parent-managed child under 13 keeps those blocks; a parent can buy coins and subscriptions for them, which the current checkout already restricts when `is_minor`. Confirm the rule for family accounts.

## 4. Security observations (relevant to the build)

- Authorisation today for paying on behalf of another user is correct: it is enforced **inside the database function** with `relationship_allows`, not in the browser. Every new family function must do the same (permission **and** relationship), never trust a `student_id` from the client.
- `qb_relationship_request` lets any user request a link to **any** profile id. For family we need the opposite for existing students: the student (or their guardian) must accept, and the lookup must not reveal profile data before acceptance.
- Coin crediting already happens only after a verified webhook, with idempotency keys and an immutable ledger. Do not add any client-side credit path.
- Invitation tokens: random 32 bytes, store only a hash, single use, short expiry, revocable.
- IDOR tests must exist for each family read (progress, wallet, assignments, subscriptions, activity, profile).

## 5. Proposed delivery order (each step is its own reviewed PR; migrations applied by the owner)

| Phase | Deliverable | Needs migration |
|---|---|---|
| 1 | Family workspace, extended relationship types and permissions, `qb_family_*` authorisation helpers, audit, IDOR test harness | Yes |
| 2 | Add child (new, via server route as for managed learners), link existing (pending until accepted), single-use invitation, access reset, revoke | Yes |
| 3 | Parent dashboard, child cards, child page (existing design kit) | No |
| 4 | Parent assignments (D2) and challenges (D3), parent-targeted feed items with provenance | Yes |
| 5 | Marketplace purchases into a family library and assign from it | Small |
| 6 | Family wallet, buy coins for one child (UI over the existing checkout), then all children (D4) | Yes (order) |
| 7 | Subscriptions for one, selected, or all children; weekly and yearly plans in config | No / small |
| 8 | Unified student feed with source filter | Small |
| 9 | Parent analytics behind `can_view_progress` | No |
| 10 | `/admin/families` | No |

Each phase ships behind a flag (`flags.family_workspace`), off in Production until the owner switches it on, so existing Student, Teacher and School flows are unaffected.

## 6. What is not being done

- No new student model, assessment engine, payment service, wallet, plan table or marketplace table.
- No change to sign-in, teacher assignments, school directory or the existing guardian/sponsor relationship behaviour (it is extended, not replaced).

## 7. Owner decisions (2026-11-16) and the buying rule

- D1 to D5 accepted as recommended: Parent is derived from owning a Family workspace (no new `qb_role`), parent assignments use a hidden per-family class (D2), the under-13 blocks stay.
- **Buying rule (phases 6 and 7).** Each child may need something different, so buying never assumes one choice for everyone. Every coin and subscription screen shows the parent's children as a **tick list with "Select all"**, and a plan for each ticked child (Monthly, Term or Yearly). A bigger bundle for several children is one checkout: one `payment_intent` per ticked child under one order, so each child gets their own entitlement and can later be changed or cancelled on its own. "Per child" amounts are shown child by child with the total before paying. The tick list only offers children the parent holds `buy_coins` or `buy_subscription` permission for, checked in the database, not the browser.
- Plans: the plan list gains **weekly and yearly** next to the existing monthly and term plans (a change to `config/subscription-plans.json`; no new tables).

## 8. Phase 1 delivered

Migration `20261079100000_family_workspace.sql` (off behind `flags.family_workspace`): `family_workspaces`, family link types and a `permissions` object on `account_relationships`, `qb_family_open`, `qb_family_children`, `qb_family_can`, `qb_family_child_summary`, `qb_family_revoke`, and the service-only `qb_family_attach_child`. Tests: `lib/core/family-workspace-sql.test.ts` (13 cases, including the change-the-student-id attempts, pending, suspended, expired and withdrawn links, revocation, and privileges).

## 9. Phase 2 delivered: add a child, the single-use link, link an existing student

Migration `20261080100000_family_children.sql` (3 parts, off behind `flags.family_workspace`), routes `POST /api/family/children`, `POST /api/family/children/reset-access`, `GET/POST /api/family/activate`, the page `/join/[token]`, `lib/api/family.ts`, and a student-home card for link requests.

- **Add a child.** The server creates an auth user with a username as the sign-in and a random password nobody knows, then `qb_family_child_provision` builds an ordinary student (class from the market's grade list, age only, no date of birth stored), links it to the workspace, records the parent's confirmation, and writes an audit entry. A child under 13 keeps every existing protection (`managed_by` is the parent, `is_minor` true); 13 and over is an independent student.
- **The link.** `qb_family_invite_issue` returns a 64-character random token once; only its SHA-256 is stored; 7 days; resending or resetting cancels earlier links; `qb_family_invite_consume` uses it up atomically, so a replay, an expired link and a revoked link all fail. The link never signs anyone in: the child chooses a password and signs in normally with their username.
- **Reset access.** The old password stops working at once, a fresh single-use link is issued.
- **Link an existing student.** The parent types an email; the answer is always the same whether or not an account exists, a student the parent cannot see is never named, and nothing is shared until the student accepts on their own home screen. Managed (under-13, adult-run) accounts cannot be linked this way. Ten requests a day per parent.
- **Not yet:** the parent screens that call these (Add child form, child cards, copy link, resend, reset, revoke) are phase 3.
- **Tests:** `lib/core/family-children-sql.test.ts` (15 cases), `lib/family/child-input.test.ts`.

## 10. Phase 3 delivered: the parent screens (flag-gated, no migration)

`/family` (child cards, **+ Add child**, **Link an existing student**, the child's one-time link with Copy link and Send on WhatsApp, a waiting list for link requests) and `/family/children/[studentId]` (who the child is; make a new workspace link, Reset access, Cancel unused link, Remove from my family). Reuses the app's `qb-*` design system. The `family_workspace` flag is read like the other feature flags; the Family entry shows in the menu for teacher and sponsor accounts only while it is on, and the route is allowed only while it is on. A student never sees it. Parent sign-up as a role choice (D1) and parent-only accounts come with the sign-up phase; until then any adult account (teacher or sponsor) can open a workspace.

Not on the child page yet (later phases): work and challenges, questions, coins, subscriptions, progress, and per-child cards showing coins, plan and assignments due.
