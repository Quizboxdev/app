# Market and SME Foundation

## Deployment Boundary

The additive migration `supabase/migrations/20261002200000_market_sme_foundation.sql`
is tested against an isolated PostgreSQL runtime. It has NOT been applied to the
hosted database. No users, approved questions, legacy decisions or production
earnings were changed. Do not run a blanket migration push: this worktree contains
other pending migration files and extraction/backup artifacts.

After taking a database backup, review and execute ONLY this migration in the
Supabase SQL Editor, following the already-applied governance migrations. It is a
single transaction. Its timestamp is after existing dependencies; the CLI-created
filename was moved forward to preserve that order.

## Authorization Setup

Existing OWNER profiles with active status can configure the foundation. ADMIN is
not automatically a super administrator or a reviewer. If no active OWNER exists,
an authorized database administrator must explicitly bootstrap an existing,
verified platform administrator:

```sql
insert into public.user_capabilities(user_id, capability, active, granted_by)
select id, 'super_admin', true, id
from public.profiles
where id = 'REPLACE_WITH_VERIFIED_EXISTING_ADMIN_PROFILE_UUID'::uuid
  and lower(role::text) in ('admin', 'owner')
  and lower(status::text) = 'active'
on conflict (user_id, capability) do update set active = true;
```

This changes no auth account or role enum. Grant `content_admin` for review-work
assignment/publication and `finance_admin` for QA release/payout operations through
Admin / SME Reviewers / Capabilities. A second authorized finance administrator is
required to approve a batch created by another operator. Never grant capabilities
based on user-editable auth metadata.

Create verified SME profiles and explicit subject/domain assignments before future
editorial decisions. An admin role alone does not authorize approval, rejection or
revision. Existing login, unrelated admin access, prior approvals and publication
history remain intact. Legacy review history is not backfilled with invented times
or reviewer attribution.

## Configuration and Workflow

1. `/admin/markets`: register currencies, countries and markets. Ghana/GHS are
   compatibility seed data, not branches in shared business logic. Existing Ghana
   curricula and tenants receive a nullable market reference; source/canonical
   grade identities and official curriculum codes are unchanged.
2. `/admin/reviewers`: link existing profile UUIDs, verify qualifications/payment
   status, configure tiers, then assign subjects, optional curricula/markets,
   education levels and canonical grade-code scopes. Permissions are per domain.
3. `/admin/compensation`: create scoped policies and append rate versions. Enter
   explicit rates/currency/effective dates/funding source. No default payment
   amounts are seeded. Versions cannot be edited or deleted. End dates are
   exclusive. Within a policy, the newest effective version is selected.
4. Assign a production question through the existing content page's Assigned SME
   Reviews section, or `/review`. DEV content is excluded. Policy selection occurs
   at assignment, and its version remains pinned through completion. A missing
   applicable policy means explicitly unpaid work, not a guessed fee.
5. Assigned reviewers open `/review`, inspect the existing rich content, attest,
   and approve/request revision/reject. Independent senior QA links to a prior
   primary review event of the same question/version. Reviewers cannot publish.
6. Content administrators publish separately. Set a market's
   "Require independent senior QA" checkbox (`configuration.require_senior_qa`) when
   independent senior approval is mandatory. The latest primary work must be
   covered by senior approval; pending reviews block publication.
7. `/admin/sme-performance`: derived work metrics and currency-separated earnings
   totals. No duplicated counters or currency conversion.
8. `/admin/payouts`: inspect earnings, release verified QA work with an audit note,
   select payable rows, enter a single market/currency and an inclusive-start,
   exclusive-end period, create a batch, independently approve, then manually
   confirm paid. No payment provider or transfer is invoked.

Policy precedence: matching sponsor/tenant scope, then market, then global. More
specific matching tier/subject/education-level scope breaks ties. Equally ranked
policies fail closed. All specified dimensions must match.

Money uses PostgreSQL numeric arithmetic and configured currency precision.
Base review plus decision fee is multiplied by the configured complexity rate;
the configured bonus is then added and percentage withholding deducted. Earnings
retain those exact snapshots. QA release is mandatory before payment eligibility.
Payout minimums are checked per reviewer against pinned versions. Completed work
and earning creation are idempotent by assignment/review-event identity.

The immutable earning row retains its initial `pending_qa` status. Authoritative
current status and payout linkage come from appended `reviewer_earning_states`
through `sme_earnings_current`; never interpret the raw initial-status column as
the current balance state. Money/rate history is never rewritten.

Configuration JSON is an extension point for future market authorities, language,
school nomenclature, pricing, taxes and payment methods. Those future features are
not implemented by this phase.

## Verification

```powershell
npx.cmd vitest run lib/sme/foundation.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

After applying the migration, inspect these read-only checks:

```sql
select iso2_code, iso3_code, name from public.countries;
select name, default_currency_code, timezone, locale from public.markets;
select code, decimal_places from public.currencies;
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in
 ('countries','currencies','markets','sme_profiles','sme_domain_assignments',
  'user_capabilities','compensation_policies','compensation_policy_versions',
  'sme_review_assignments','sme_review_events','reviewer_earnings',
  'reviewer_earning_states','sme_payout_batches','sme_payout_items');
```

Then perform authenticated acceptance with separately authorized reviewer,
content-admin and two finance operators: assignment, decision, senior QA where
configured, separate publication, QA release, batch creation/approval/manual paid
record, repeat completion and paid action, and unauthorized subject/student
denial. No production money should be transferred during acceptance. These hosted
checks remain manual until this migration and capability/profile configuration
are deployed. Existing skipped live tests are not evidence of this new workflow.
