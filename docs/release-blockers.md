# Release Blocker Closure

## Wave 1 editorial content

45 original AI-assisted drafts, five per indicator, have been imported through
the existing qb_content_ingest RPC using the authorised database connector.
This administrative import is not evidence of a successful password login.
All are inactive/review, with zero automated approvals. Two unmapped legacy
QB-ACCEPT items were moved to needs_revision through qb_content_review.
No curriculum mapping was fabricated for those two items.
The production review queue contains 45 candidates. Coverage reports count 47
pending editorial items because they also include the two needs_revision items.

The nine existing Wave 1 indicators are Computing B10.2.4.1.1, B10.2.4.1.3,
B10.3.3.1.2; Mathematics B10.1.3.1.1, B10.1.3.1.2, B10.1.3.1.3; Science
B10.1.2.1.1, B10.1.2.1.2, B10.1.2.1.3. Learner grouping is SHS1, while
source labels and curriculum codes remain B10. Source-PDF SHA256 and printed
page references are retained. Objective summaries clarify truncated imported
titles without changing the taxonomy or claiming verbatim transcription.

Run npm.cmd run content:wave:import -- --dry-run to validate and inspect counts.
Authenticated CLI import uses --apply and replays idempotently. It does not
approve or publish. The private prepared JSON is .local-backups/wave-one-candidates-v1.json.
Admin review defaults to production only; it displays objective, answer text,
explanation, difficulty, source and validation warnings, with Approve & Next,
Reject & Next and Needs Revision & Next. Review must remain a human decision.
After academic approval, separately publish the approved version for delivery.

## Leaked password protection

The available connector has no Auth-configuration mutation endpoint, and no
Management API token has been supplied. No configuration change was claimed.
Current security-advisor evidence still reports protection disabled.

Open https://supabase.com/dashboard/project/fmgccmqxfjppqydkhaiu/auth/providers?provider=Email
then Authentication > Sign In / Providers > Email > Password security.
Enable Prevent use of leaked passwords (leaked password protection), save,
then refresh the Supabase security advisors. Supabase documents this setting
as available on Pro and above; no paid upgrade has been performed.
Reference: https://supabase.com/docs/guides/auth/password-security

## Acceptance credentials

No live passwords are embedded in source. Acceptance logins require environment
identifiers and passwords, and reject NODE_ENV=production, VERCEL_ENV=production,
production project references and missing acceptance authorisation. Use the blank
QB_ACCEPTANCE_<ROLE>_EMAIL/PASSWORD fields in .env.example in an ignored local file.
Legacy QUIZBOX_<ROLE>_EMAIL/PASSWORD environment fields remain supported during
transition. The reserved-email comparison is a safety allowlist, not a login default.

Accounts requiring operator rotation/revocation or verified separate-project isolation:

- admin.test@quizbox.local
- student.test@quizbox.local
- student2.test@quizbox.local
- teacher.test@quizbox.local
- sponsor.test@quizbox.local
- seller.test@quizbox.local

The configured admin password was rejected; update it locally, never in chat.
Supply a distinct student2 credential and distinct credentials for every role.
Set QB_ENVIRONMENT=acceptance and QB_ACCEPTANCE_PROJECT_REF to the explicitly
authorised acceptance project. Never classify a production deployment as acceptance.
Run npm.cmd run acceptance:run -- test for authenticated tests.

If these accounts remain in the current project, perform authorised rotation with
npx.cmd tsx scripts/rotate-acceptance-credentials.ts --apply --confirm-test-rotation
only after all current per-role environment credentials are valid. The script
preflights all six identities, writes a private replacement file before updates,
revokes refresh sessions and verifies old-password rejection. No rotation ran here.
Already-issued access JWTs can persist until expiry. Isolate/revoke acceptance
accounts and privileges before opening the project to production learners.
Historical shared-password exposure is not fixed merely by removing source literals.

## Backup and isolated restore

29-table API exports are private and checksum-verified. They include questions,
versions, taxonomy, class/assignment/assessment snapshots, learner events, mastery
and XP. They are not a transaction-consistent database snapshot and do not include
Auth credentials, function definitions, storage binaries or all platform tables.
Their checksums do not establish that a database can be restored.

No isolated Supabase branch or PostgreSQL toolchain was available. Gate:
MANUAL VERIFICATION REQUIRED.

Using an existing PostgreSQL toolchain, configure PGHOST to
db.fmgccmqxfjppqydkhaiu.supabase.co, PGDATABASE=postgres, PGUSER to the authorised
operator and PGPASSFILE to a private operator-managed credential file. Run:

```powershell
powershell -File scripts/backup-schema.ps1 -OutputDirectory "$PWD/.local-backups/consistent-archive" -ConfirmPrivateBackup
```

Retain the custom-format archive and SHA256 privately, export storage binaries
separately and encrypt backups according to the operator's established process.
For an explicitly disposable, separately provisioned compatible target, set
QB_ENVIRONMENT=restore, QB_RESTORE_PROJECT_REF, QB_PRODUCTION_PROJECT_REF,
PGHOST=db.<restore-ref>.supabase.co, PGDATABASE=postgres, PGUSER and PGPASSFILE:

```powershell
powershell -File scripts/restore-isolated.ps1 -Archive "$PWD/.local-backups/consistent-archive/quizbox.dump" -ConfirmIsolatedRestore
```

The script refuses the current live project, connection overrides and missing or
mismatched archive checksums. It does not use --clean or drop existing objects.
Restore runs in a single transaction and fails on target schema conflicts; prepare
and review a compatible disposable target first, especially managed Auth/Storage
schemas. Do not resolve such conflicts by pointing it at production or dropping
production objects. Compare table counts, UUID/FK linkage, snapshots, mastery and
XP; verify object downloads and run the authenticated acceptance suite on the
isolated target. Only that operator-verified rehearsal can close the restore gate.

## Fail-closed release check

npm.cmd run release:check remains nonzero while approved production content is
zero, password protection is disabled, test credentials are not rotated/isolated,
or restore evidence is missing. An unavailable authenticated audit produces a
persisted NOT READY report, never a stale or fabricated PASS. Unit test success
with skipped live tests is not authenticated acceptance evidence.
