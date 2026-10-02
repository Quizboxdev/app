# Market enforcement activation

## State and scope

Prepared locally, not deployed. Neither the market/SME foundation nor the content
enforcement migration has been applied to the production project by this task.
Do not deploy the frontend ahead of these dependencies. Do not bulk-apply this
dirty worktree's migration directory: it contains unrelated repair/backup files.

The production schema inspection found `GH-CCP-2020` and `GH-SOURCE`, both country
Ghana, with no source name/hash. Only the recognizable CCP authority is seeded;
verify the imported-source authority independently. No curriculum/source approval
is inferred from a filename, user role, currency or language.

Local verification: 273 tests passed, 95 existing live tests skipped, including
38 isolated market-governance PostgreSQL tests. Typecheck and full lint passed.
Read-only hosted preflight matched guard markers/query patterns in all 24
inspected existing RPC definitions (including both assignment overloads).
This preflight is not a staging migration or authenticated hosted acceptance.

## Isolated staging rehearsal

1. Take and verify the existing non-destructive backup package. Restore a current
   schema/data copy into an isolated staging project, never into production.
   Handle copied user data and credentials under the existing isolation policy.
2. Apply only these reviewed files, in this order, using the staging SQL Editor:
   `20261002200000_market_sme_foundation.sql`, then
   `20261002210000_content_market_enforcement.sql`. Each is transactional. A
   contract mismatch must abort; inspect the differing function before changing
   the migration. Do not replace budget-wrapped production RPCs with old copies.
3. Use an existing OWNER or a separately verified explicit `super_admin`
   capability. ADMIN alone is not this capability. Do not change any production
   user's role or credentials to pass a test.
4. In `/admin/markets`, review authorities and curricula-by-market. Confirm
   `GH-SOURCE` authority from the import's official provenance before mapping it.
   Inspect `market_attribution_issues`; assign ambiguous users/content only after
   evidence review. User/sponsor assignment uses profile UUIDs, not client claims.
5. Register sources through the existing source-document ingestion workflow.
   Inspect ownership, rights, checksum, exact authority/curriculum/market and
   verified source extracts before approval in Source Documents. Do not approve
   acceptance fixtures or fabricate source extracts. Register a new document
   version for content changes; reject an approved source to revoke its use.
6. Configure sponsor contexts explicitly: LOCAL_MARKET + one market; MULTI_MARKET
   + at least two authorized markets; GLOBAL + explicit sponsor documents/packs.
   Set the source mode independently. A binding is fixed once saved. Existing
   unconfigured competitions stay hidden from ordinary users; do not bypass this.
7. Run the local checks below. Then use staging test users to exercise each case
   in the authenticated matrix. Capture actual HTTP/RPC responses and session
   identity, without tokens, passwords or private answer payloads in evidence.
8. Run Supabase Security Advisor on the staging project after applying migrations.
   Compare with the baseline below and review every new finding. Do not call
   existing authenticated RPC warnings proof of exploitable bypass or remove
   required authenticated execution just to silence the advisor.
9. Only after an explicit production-activation/deployment authorization and a
   passing staging rehearsal: apply the same reviewed files, configure verified
   sources/memberships, deploy matching frontend, rerun hosted authenticated
   checks and Security Advisor. This task does not authorize that deployment.

```powershell
npm.cmd test -- lib/content/market-context.test.ts lib/content/market-enforcement.test.ts lib/content/factory/factory.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Read-only operator coverage now requires an explicit configured market:
`npm.cmd run content:factory -- coverage --server-readonly --market=<market-uuid>`.
No service-role credential is used for editorial mutation or provider generation.

## Authenticated staging matrix

| Actor / context | Required actual result |
| --- | --- |
| Ghana teacher, local default | Ghana curriculum/questions visible; foreign curriculum/node/question URL and direct REST queries denied/empty |
| Ghana student, assigned grade | Local grade-matched practice visible; foreign assessment start rejected; lifecycle still hides active answer keys |
| Multi-market teacher, local default | Foreign assigned market still hidden until explicit switch or multi-market selection |
| SME reviewer | Assigned market + subject + curriculum + education level required for queue, detail and decision; revoked domains/membership denied |
| Ordinary ADMIN | No implicit cross-market/Super Admin access |
| Verified Super Admin | Explicit market switching and scoped configuration succeeds; original tenant/role rules remain |
| Sponsor LOCAL_MARKET | Exactly one authorized market; wrong-market document/competition rejected |
| Sponsor MULTI_MARKET | Explicit authorized markets and sources only; no automatic national union |
| Sponsor GLOBAL | Explicit sponsor documents or approved mapped packs only; national corpus directly selected fails |
| Source modes | Curriculum-only, sponsor-only and hybrid each pass only their matching authorized approved sources |
| Generation | Foreign, unapproved, revoked or missing sources fail before provider invocation; job retains source IDs/checksums/audience/context |
| Existing Ghana data | No question text/answer/approval changes; source B10 and canonical SHS1 remain distinct; legacy attribution agrees with nodes |
| Resume | Attempt context remains fixed; original owner/auth/tenant checks and assessment answer hiding still hold |
| Malicious direct client | Cannot assign membership, approve sources, forge contexts or replace frozen competition/attempt/batch context |

Check attribution/configuration with privileged read-only staging SQL:

```sql
select entity, reason, count(*) from public.market_attribution_issues group by entity, reason;
select c.code, mc.market_id, a.code authority_code
from public.curricula c left join public.market_curricula mc on mc.curriculum_id=c.id
left join public.curriculum_authorities a on a.id=mc.authority_id;
select validation_status, source_kind, count(*) from public.source_documents
group by validation_status, source_kind;
select count(*) from public.profiles where default_market_id is null;
```

## Hosted baseline, 2026-10-02

Read-only production Security Advisor inspection before these migrations:
32 RLS-without-policy informational findings, one anonymous SECURITY DEFINER RPC
warning (intentional public marketplace catalogue), 77 authenticated
SECURITY DEFINER RPC warnings, and leaked-password protection disabled.
These are baseline findings, not a post-migration clearance.

Enable and verify leaked-password protection separately in Supabase Authentication
settings. Existing content approval, credential rotation and restore-verification
release gates are unchanged by this task. The 95 existing skipped live tests are
not counted as passing authenticated acceptance.
