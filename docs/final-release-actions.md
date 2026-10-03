# Final release actions

No production candidate was approved by automation. The production-first review
console requires human review of the two legacy candidates, including resolution
of their missing curriculum mapping. The nine-indicator production manifest has
45 validated local queued jobs and no configured provider. The queue is a local
manifest, not evidence of live AI execution.

## Auth security

Open Supabase Dashboard for the existing project > Authentication > Settings >
Security and Protection (Attack Protection in some dashboard versions). Enable
leaked-password protection. If the plan does not support it, resolve the plan
prerequisite. Run the live security advisor; absence of its disabled-protection
warning alone is not a substitute for a verified live enabled setting.
The configured SQL connector cannot administer Auth management settings.

Rotate these acceptance identities in Authentication > Users:
admin.test@quizbox.local, student.test@quizbox.local, student2.test@quizbox.local,
teacher.test@quizbox.local, sponsor.test@quizbox.local, seller.test@quizbox.local.
Revoke their refresh sessions and account for the existing access-token lifetime.
Move acceptance fixtures to a separate non-production project before public
release. No accounts or passwords were changed automatically in this execution.
Provide replacement credentials through an ignored local operator environment,
never chat or source. Verify old credentials fail on the intended project after
rotation; do not certify that test until rotation actually occurs.

## Recovery rehearsal

The private JSON package now covers 29 tables, including profiles, classes,
assignment versions, assessment snapshots, attempts/responses, mastery and XP.
It contains private answer and learner data and must remain encrypted, private
and off Git. JSON checksums establish file integrity, not snapshot consistency:
API exports are sequential reads while live writes may occur.

Create a transaction-consistent custom-format pg_dump archive using an existing
PostgreSQL toolchain and an operator-managed PGPASSFILE. Include the required
public/private schema, Auth identity linkage and stored function definitions.
Export storage binaries separately. Do not restore JSON tables blindly: foreign
keys, Auth UUIDs, trigger side effects and dependency cycles require the schema
archive and controlled restore ordering.

Use a disposable separate Supabase project. Set QB_ENVIRONMENT=restore,
QB_RESTORE_PROJECT_REF, QB_PRODUCTION_PROJECT_REF, PGHOST=db.<restore-ref>.supabase.co,
PGDATABASE=postgres and private PGPASSFILE. Run:
`powershell -File scripts/restore-isolated.ps1 -Archive <private-custom-archive> -ConfirmIsolatedRestore`
Compare counts and checksums for curricula, nodes, questions, versions,
assignment/assessment snapshots, mastery and XP; then run authenticated tests
against the isolated project with acceptance credentials. No restore has been
performed, because no isolated target credentials or PostgreSQL runtime were
available. The script refuses the current live project and production reference.

## Remaining verification

The learner drill-down now pages on the server. Teacher overview aggregation
still requires a server-aggregated paginated replacement; do not silently limit
input rows because that changes analytics semantics. Positive media delivery and
exact-width visual certification remain unverified. Legacy mutation tests cover
ordinary-role denial and seller ownership; the full authorized competition and
cross-tenant mutation matrix remains incomplete.
