# Sponsor competition lifecycle activation

## Current boundary

Local domain implementation, authenticated PostgreSQL adapter tests and gated
organization/draft/upload UI. No paid provider calls, hosted
database writes, production deployment or sponsor privileges changed.
The sixth migration extends existing question, assessment and SME tables additively
and wraps (never weakens) the market and attempt-review predicates.
This is not a release candidate: browser acceptance, background scheduling and the
hosted gates remain unfinished. Do not deploy it as a completed engine.

## Migration order

Use `content-market-activation.md` as the governing activation procedure. After
explicit staging authorization and verified isolated restore, apply only:

1. `20261002200000_market_sme_foundation.sql`
2. `20261002210000_content_market_enforcement.sql`
3. `20261002220000_sponsor_competition_lifecycle.sql`
4. `20261002230000_sponsor_authenticated_workflows.sql`
5. `20261002240000_sponsor_candidate_review_bridge.sql`
6. `20261002250000_sponsor_source_delivery.sql`
7. `20261002260000_legacy_node_attribution.sql` (legacy Ghana questions attributed through their governed node)
8. `20261002270000_competition_review_operations.sql` (content-admin assignment queue, source excerpt, participant labels)
9. `20261002280000_hot_path_performance.sql` (hot-path indexes, RLS initplan, teacher indicator summary)

Full production procedure: `docs/production-activation-checklist.md`.

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
outputs; it is exercised with mocks over PostgreSQL. The workspace now exposes an
explicit Run generation action. Queueing alone never calls a provider. Execution
requires server-only `QUIZBOX_GENERATION_PROVIDER`, `QUIZBOX_GENERATION_MODEL` and
`QUIZBOX_GENERATION_ENDPOINT`; optional `QUIZBOX_GENERATION_API_KEY` is never sent
to the browser. The endpoint is an explicitly configured adapter accepting
`{ input, chunks }` and returning the existing `Candidate[]` contract, not an
inferred vendor API. It must match the provider/model pinned in the job.
No provider was configured or called during this work; test HTTP responses are mocked.
The request has a 60-second deadline and a bounded response. No automatic retries.
Failed executions without candidates may be explicitly retried up to three
executions; a processing lease can be reclaimed only after ten minutes. Reclaim
revokes the old token, so late completions cannot persist candidates.

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
The upload-retry API and file-retry control are present. Select Retry upload on a
failed item, then provide the original file. The original document identity, title,
ownership and metadata are retained; checksum/MIME mismatches are rejected. Failed
uploads are not incorrectly offered extraction retries, and errors refresh the
persisted status. Wizard browser acceptance remains unexecuted without a local
Supabase runtime; pure save/resume and authenticated database adapter tests are
not a substitute for browser acceptance.

## Candidate review bridge and exact stopping boundary

The fifth migration extends the existing workspace RPC; it does not replace the
generation, source authorization, SME or compensation implementations. All added
persistence is private, RLS-enabled and without browser table grants. Candidate
assignment requires content-admin authority plus sponsor access. It links only
an existing imported question whose curriculum, stem, options, answer, explanation,
subject and source provenance match the generated candidate. Assignment and direct
review use the existing scoped `qb_sme_*` RPCs. No automatic approval is performed.

Completed SME events synchronize candidate state and append immutable history.
The existing rate resolver/ledger pins the exact policy version and creates one
earning per event. When no policy resolves, question approval is not blocked;
the immutable review record reports `COMPENSATION_UNRESOLVED` through the
Super Admin-only `oversight` workspace action. Bank inclusion rechecks current
source approval, context, completed reviews, exact approved question-version
identity and target count; it rejects stale versions. Bank exclusion is persisted.
Difficulty/topic-balanced publication and an oversight UI are still unfinished.

## Source-only delivery (sixth migration)

The sixth migration closes the former candidate-materialization FAIL without
fabricating curriculum nodes. Questions gain `content_origin`
(`CURRICULUM`, `SPONSOR_DOCUMENT`, `HYBRID`), `origin_candidate_id` and
`origin_metadata`; a null grade is allowed only for sponsor-origin rows. The
original curriculum predicates (`question_allowed`, `question_guard`,
`qb_content_validation_errors`, `assessment_allowed`, `qb_get_attempt_review`) are
copied to private names and still govern every curriculum row unchanged. Sponsor
rows instead require verified provenance (approved, rights-confirmed source, exact
job/draft context, completed SME review event). The curriculum-only insert guard is
not relaxed; curriculum-aligned candidates still need a real authorized node.

SME assignments/events may now reference a candidate directly. Review revisions,
version-pinned earnings, balanced bank inclusion, immutable snapshot, publication,
eligibility/registration, invitations, frozen delivery through the existing attempt
engine, immutable official results, leaderboard, sponsor analytics and Super Admin
oversight are persisted in private RLS-enabled tables with no browser grants. A
restrictive `sponsor_answer_isolation` policy hides sponsor questions from anyone
who is not a member, assigned reviewer or registered participant. Pages:
`/competition/participate`, `/competition/attempt/[id]`, `/competition/results/[attemptId]`,
`/review` (candidate reviews) and `/admin/competitions/oversight`.

Evidence: `lib/competition/source-delivery.test.ts` runs the whole chain over the
isolated assessment, governance and SME SQL fixtures (PGlite), including second
participant ranking, XP/learning-event idempotency and negative tenant checks.
These are fixtures, not hosted acceptance.

Pending: browser acceptance (`tsx scripts/sponsor-browser-fixture.ts --local-only`
against the in-memory fixture), background execution scheduling, aggregate analytics
beyond a single competition, and participant display names on the leaderboard.
The central document-owned resolver uses active membership for managed sponsor
organizations, including revocation of the original uploader; unmanaged sponsors
keep legacy behavior. This change still needs a full combined-foundation integration rehearsal before
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

When the sixth migration is present, reverse it first using
`supabase/rollback/sponsor_source_delivery.sql`. It restores the preserved original
predicates in place, the review-bridge dispatcher and the earlier grants. Its empty
reversal and reapplication are tested; it refuses once registrations, invitations,
results, sponsor-origin questions/assessments or candidate SME work exist.

When the fifth migration is present, reverse it BEFORE the fourth using
`supabase/rollback/sponsor_candidate_review_bridge.sql`. Its empty reversal is tested;
it refuses reversal after review history or executions are present. Archive/restore
is required for populated workflows. Production remains untouched.
