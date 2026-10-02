# Production closure runbook

The release remains blocked while approved production question coverage is zero.
Fixtures and local sample candidates are not production editorial content.

## Operator environment

Use an ignored local environment file or a protected CI secret store. Set
QB_CONTENT_OPERATOR_EMAIL and QB_CONTENT_OPERATOR_PASSWORD for an authorized
administrator. Live acceptance additionally requires QB_LIVE_ACCEPTANCE=1,
QB_ENVIRONMENT=acceptance, QB_ACCEPTANCE_PROJECT_REF matching the intended project,
and QB_ACCEPTANCE_PASSWORD. Set QB_PRODUCTION_PROJECT_REF to protect the production
project from acceptance execution. Do not use a browser service-role credential.

Run `npm.cmd run release:check`. A nonzero result is expected until all P0 gates
are resolved. Review both release-readiness reports; do not suppress failures.

## Required manual security actions

In Supabase Dashboard, Authentication > Settings > Security and Protection,
enable leaked-password protection (availability depends on the project plan).
Rerun the security advisor and retain evidence that the warning is gone.
Rotate all previously shared acceptance passwords, revoke their sessions, and
isolate acceptance accounts in a non-production project before public release.
Never place passwords in source, command transcripts, or reports.

## Backup and recovery

`npm.cmd run backup:content -- --confirm-private-backup` writes an ignored private
content export and checksum manifest. Reopening it verifies the export, not a
database restore. Retain an encrypted off-machine copy under controlled access.
Use Supabase Dashboard > Database > Backups to verify the actual backup schedule,
retention and latest successful backup; configure PITR if required by recovery
objectives. Perform a restore to a separate disposable project, never production.
Compare curriculum, question, option, media metadata and review-history counts;
run authenticated learning and privilege tests on that restored project.
Storage objects need a separate private backup; metadata exports do not contain
image binaries. Auth users and student responses are not in the content export.

For schema export, use the existing Supabase CLI `supabase db dump --linked
--file <private-backup-path>/schema.sql` with its required authenticated project
and Docker environment. Those infrastructure prerequisites were unavailable in
this execution; schema export and isolated database restoration are not verified.
Restore fixtures only through the guarded seed command in an acceptance project
with explicit --apply and --confirm-fixtures. Do not import test accounts into
production.

## Content and operational boundaries

Human reviewers must verify curriculum alignment, factual answers, distractors,
explanations and provenance before approval. No production candidate was
automatically approved. Wave 1 local samples prove only the pipeline.
Inspect failures with `npm.cmd run ops:recent`; client failure events are tagged
untrusted. Successful RPC requests consume durable per-actor budgets. Failed
class-code guesses also persist their budget; exceptions in other RPCs can roll
back budget increments and need additional failure-abuse hardening before scale.

The three closure migrations were applied to the current live project. Do not
blindly push historical migration backups or repair artifacts. Reconcile deployed
migration receipts before deploying the closure migrations to another project.
Local dependency order is 20261002170000_production_readiness_security.sql,
20261002171000_coverage_targets_media.sql, then
20261002172000_legacy_privilege_boundary.sql. Their live connector deployment
receipts may use different generated versions; do not reapply them blindly.
Positive end-to-end image upload/retrieval, full legacy mutation-role matrix,
remaining learner analytics pagination and responsive screenshots still need
verification. A private content export is not an infrastructure backup certificate.
