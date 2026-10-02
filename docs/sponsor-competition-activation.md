# Sponsor competition lifecycle activation

## Current boundary

Local domain implementation and mocked tests only. No provider calls, hosted
database writes, production deployment or sponsor privileges changed.
The existing Ghana sponsor dashboard, competitions and assessment RPCs are unchanged.
This is not a release candidate: persistent authenticated adapters, UI and several
workflow integrations remain unfinished. Do not deploy it as a completed engine.

## Migration order

Use `content-market-activation.md` as the governing activation procedure. After
explicit staging authorization and verified isolated restore, apply only:

1. `20261002200000_market_sme_foundation.sql`
2. `20261002210000_content_market_enforcement.sql`
3. `20261002220000_sponsor_competition_lifecycle.sql`

The third migration adds a private schema only. No existing question, sponsor,
competition, profile or assessment records are changed. It prepares organizations,
members, drafts, documents, traceable chunks, generation jobs, candidates, append-only
reviews, version-linked bank items, immutable snapshots and attempt references.
All private tables have RLS enabled and no browser grants. Lack of policies is an
intentional closed boundary, not completed authenticated access. Do not grant public
access to make UI development pass. Service writes also need explicit adapters.

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

Pending: sponsor organization provisioning, wizard and upload routes, extraction
adapters for PDF/DOCX/TXT, persisted job execution, SME work assignment/decision
transactions, existing compensation RPC integration, bank balancing, assessment
snapshot adapter, discovery/registration, aggregate analytics and Super Admin UI.
No compensation rate/currency is inferred. No live payments are in scope.

## Reversal and deferred hosted gate

The isolated PostgreSQL test exercises `supabase/rollback/sponsor_competition_lifecycle.sql`
and verifies removal of the empty private schema without altering public rows.
The rollback refuses populated tables. Before reversal in any authorized target,
archive all new workflow data; dependency review is mandatory. Do not use cascade against
production. Hosted tests, Security Advisor comparison, Ghana baseline checks,
source approval/provenance and backup/restore evidence remain deferred gates.
Do not request production activation before authenticated adapters and UI pass.
