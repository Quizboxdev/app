# Governed Question Factory

## Contracts

Operational status is active, inactive or archived. Editorial validation_status
is draft, generated, review, approved, rejected or needs_revision. Approved is the
only delivery state. Structural validation is not academic approval.

Ingestion keeps the original candidate in question_import_staging. Valid candidates
enter inactive/review; invalid candidates remain rejected staging records. Existing
external IDs are rejected, never overwritten. Batch replay uses a server-computed
hash of the specification and candidates. Database hashes detect exact duplicates;
the CLI also reports near matches using normalized-token Jaccard similarity.
Near duplicates are never automatically deleted.

Every candidate references an actual active learning indicator/objective. Source
B10 and official B10 curriculum codes remain intact; learner grouping uses SHS1.
Factory MCQ requires four distinct options and an A-D key. True/false uses
A=True, B=False and answer_spec.boolean. Human reviewers must assess factual
accuracy, defensible answers, distractors, explanation, language and alignment.
The validator cannot prove these semantic properties.
The initial factory supports MCQ/true-false with text/math blocks. New image-block
ingestion is not implemented; existing player image snapshots are unchanged.
Rich-content keys are allowlisted so answer-bearing metadata cannot be smuggled
into an otherwise valid active payload.

## Review

/admin/content contains Editorial Review, Curriculum Coverage and Batches.
Review notes are required. Approval requires explicit human attestation and
valid structure; approved content remains inactive until separately published.
Edits use version/state optimistic concurrency, preserve immutable content
versions, reset approval and withdraw the edited version from new selection.
Existing assessment snapshots are not changed by content edits.
Snapshots record source, question version and approval-at-publication evidence.
Uncertified legacy standalone snapshots are hidden from new delivery; historical
results remain available to their owners. Controlled fixture snapshots retain the
explicit acceptance-only exception.
Batch reports retain ID-only editorial events, without answers or credentials.

Only ADMIN/OWNER can manage platform content. No CONTENT_EDITOR role is invented.
Students cannot read raw question rows or answer columns. Teacher selection is
limited to governed available metadata under tenant RLS. Attempt RPCs retain
ownership checks, answer hiding and per-response practice reveal.

## Generation Boundary

QuestionProvider separates prompts, provider execution and output parsing.
SampleProvider exercises supplied local JSON only. No paid provider is installed
or called. Generation requests persist in PREVIEW/awaiting_provider; an operator
must configure a provider worker before requests can execute. Candidates never
auto-approve, regardless of provider output or structural checks.

## Operator CLI

Use npm.cmd run content:factory -- followed by:
The dry-run example is scripts/fixtures/factory-example.json, mapped to a live
Mathematics indicator. It does not write data unless an operator explicitly applies it.

- coverage: writes reports/question-coverage.json and .md for all nodes.
- validate candidate.json: validates {spec,candidates}; invalid rows exit nonzero.
- duplicates candidate.json: flags exact/near matches inside the supplied batch.
- generate candidate.json: dry-run generation with supplied local SampleProvider.
- import candidate.json: dry run; --apply ingests unapproved candidates.
- publish approved.json: dry run; --apply publishes only already-approved IDs.
  Input is {ids:[uuid],note:"operator publication reason"}.
- rejected batch-id: exports row numbers and rejection codes, not answer payloads.

Provide QB_CONTENT_OPERATOR_EMAIL/PASSWORD locally, never in Git. Editorial
mutations use an authenticated anon-key client, not service-role bypass.
--apply is never an approval instruction. Rejected reports are bounded to the
100-row maximum ingest batch. Batch/queue/coverage pages are 25 rows.
Coverage and import require an authorized operator. No secrets are logged.

## Coverage and Fixture Separation

Central targets live in lib/content/factory/contract.ts: minimum 10, easy 3,
medium 4, hard 3, strong 20. The pure coverage engine supports a configurable
minimum, rolls counts from indicators to ancestors and includes type coverage.
The current dashboard uses these defaults; per-grade/subject saved overrides
and dashboard type breakdowns are not implemented.

DEV_ACCEPTANCE_FIXTURE and DEV_FACTORY_PILOT never count as production coverage.
Fixtures are allowed only for authenticated reserved acceptance emails verified
against the confirmed auth.users record and an exact six-account allowlist, not
editable client metadata or a wildcard email pattern. Their assignments are restricted
to the named developer acceptance class. Do not provision real learner accounts
with reserved quizbox.local test identities.

The controlled local factory pilot imports four candidates per subject: two
distinct questions, one exact duplicate and one intentionally invalid option.
Nine questions enter review; three candidates remain rejected staging rows.
Live tests simulate review/publication on explicitly isolated pilot records only.
This is not human academic approval or external AI generation evidence.

## Verification Boundaries

QB_LIVE_ACCEPTANCE=1 enables authenticated tests with reserved test accounts.
The practice harness publishes fresh isolated assignments per run to avoid
expired-attempt false failures. Original acceptance evidence is retained.
New live evidence is in reports/hardening-learning-acceptance.json.
mastery_records.attempts_count currently counts learning evidence rows, not
distinct attempts; tests preserve that accepted engine contract.

API contract tests cover manual/automatic publication; a live labeled class test
exercises creation, idempotent joining and archival without modifying real classes.
live practice tests cover targeted delivery, exclusion, save/resume, authoritative
completion, events, mastery and XP retry. These are not blanket UI E2E evidence.

New content requests are bounded/idempotent; completion is idempotent, attempts
are capped and serialized per learner/assessment. Platform-wide IP rate limiting,
durable failed-class-code guess throttling, complete student/attempt pagination
and broad operational event instrumentation remain follow-up work.
Gradebook pages are server-bounded to 50 records; analytics aggregates are unchanged.
PostCSS is pinned to a patched compatible 8.x version. The existing XLSX dependency
still has high-severity npm advisories and no patched npm registry release.

No infrastructure backup, restore drill or deployment is certified by these tests.
Public-signup profile provisioning is not covered by this acceptance suite; the
inspected auth.users table has no application provisioning trigger. New accounts
need an established profile-provisioning mechanism before public onboarding.
Rotate or isolate reserved test credentials before production onboarding.
