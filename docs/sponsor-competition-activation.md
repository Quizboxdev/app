# Sponsor competition lifecycle activation

## Current boundary

Local domain implementation, authenticated PostgreSQL adapter tests and gated
organization/draft/upload UI. No paid provider calls, hosted
database writes, production deployment or sponsor privileges changed.
The existing Ghana sponsor dashboard, competitions and assessment RPCs are unchanged.
This is not a release candidate: review/publication/delivery adapters and several
workflow integrations remain unfinished. Do not deploy it as a completed engine.

## Migration order

Use `content-market-activation.md` as the governing activation procedure. After
explicit staging authorization and verified isolated restore, apply only:

1. `20261002200000_market_sme_foundation.sql`
2. `20261002210000_content_market_enforcement.sql`
3. `20261002220000_sponsor_competition_lifecycle.sql`
4. `20261002230000_sponsor_authenticated_workflows.sql`

The third migration adds a private schema only. No existing question, sponsor,
competition, profile or assessment records are changed. It prepares organizations,
members, drafts, documents, traceable chunks, generation jobs, candidates, append-only
reviews, version-linked bank items, immutable snapshots and attempt references.
All private tables have RLS enabled and no browser table grants. The fourth migration
adds a public INVOKER workspace RPC delegating to an authenticated private implementation,
with database memberships, optimistic draft revisions, extraction claims, authorized
generation claims, immutable chunks and forced-unapproved candidate persistence.
It creates a dedicated private source bucket with membership-bound object policies.
No service-role key is used by either HTTP route. Table access stays closed.

The authoring page is `/sponsor/workspace`. To enable ONLY against a separately
configured local Supabase instance, set process-local `QUIZBOX_SPONSOR_ENGINE_ENABLED=true`
and point the normal public client URL/key at that local instance. The HTTP routes
and page reject every hosted URL, including the existing production project, even
when the flag is enabled. Do not edit production environment settings for this.
No local Supabase runtime was installed or started by this task.

The UI saves/resumes drafts and authoring steps, selects authorized markets/sources,
manages organization membership, uploads/extracts supported sources and queues/cancels
generation jobs. Source approval remains a separate verified Super Admin action.
Generation execution accepts an injected provider adapter and persists candidate
outputs; it is exercised with mocks over PostgreSQL. No production provider or
background execution runner is configured, and queueing alone does not run a provider.

## Local acceptance and pending integration

Run `npm.cmd test -- lib/competition/lifecycle.test.ts` and the PostgreSQL schema
tests, then typecheck, lint, full tests and build. These are local checks, not hosted
acceptance. Validate cross-sponsor identity and rights using authenticated server
catalogues before invoking the domain module; never trust browser-provided actor,
source approval, review status, official scores or bank-version approval.

Repository transactions must revalidate sponsor status, source rights/approval,
reviewer assignment and exact question-version identity at publication. Persist
the snapshot and create its assessment atomically; row-lock attempt limits and
snapshot identity before invoking `qb_start_attempt`. Use existing save/get/complete
and result RPCs for answer hiding and official scoring. Participant discovery must
return metadata only, never candidate payloads or source answer keys.

Real PDF/DOCX/TXT extraction is verified with deterministic local parser fixtures.
Upload failures persist as failed records; checksum-preserving retries reuse the
source identity, and lost storage responses are reconciled against verified bytes.
The upload-retry API is present; a dedicated file-retry control is still needed in UI.

Pending: full wizard browser acceptance, provider/background execution integration,
SME work assignment/decision transactions,
existing compensation RPC integration, bank balancing, assessment snapshot adapter,
discovery/registration, aggregate analytics and Super Admin UI. Sponsor-source
questions without curriculum nodes need an explicit, reviewed bridge into the
existing question/assessment authorization contract; do not fabricate curriculum
nodes or weaken `question_allowed` to force them through. The central document-owned
resolver now uses active membership for managed sponsor organizations, including
revocation of the original uploader; unmanaged sponsors keep legacy behavior.
This change still needs a full combined-foundation integration rehearsal before
curriculum/hybrid generation can be certified for non-owner members. This is unfinished local work,
not a requirement to activate staging now.
No compensation rate/currency is inferred. No live payments are in scope.

## Reversal and deferred hosted gate

The isolated PostgreSQL test exercises `supabase/rollback/sponsor_competition_lifecycle.sql`
and verifies removal of the empty private schema without altering public rows.
The rollback refuses populated tables. Before reversal in any authorized target,
archive all new workflow data; dependency review is mandatory. Do not use cascade against
production. Hosted tests, Security Advisor comparison, Ghana baseline checks,
source approval/provenance and backup/restore evidence remain deferred gates.
Do not request production activation before authenticated adapters and UI pass.

Reverse the fourth migration first using `supabase/rollback/sponsor_authenticated_workflows.sql`,
then the third migration. Both refuse populated workflow data. Restoring populated
data requires an independently verified isolated backup/restore procedure, not a
destructive cascade. Existing Ghana tables and approved content are never rewritten.
