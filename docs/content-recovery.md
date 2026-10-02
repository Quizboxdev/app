# Content Recovery and Deployment

1. Preserve the accepted learning-loop migrations through practice_feedback.
2. Apply 20261002150000_question_factory_governance.sql.
3. Apply 20261002151000_question_factory_input_hardening.sql.
4. Apply 20261002152000_learning_rpc_context_hardening.sql.
5. Apply 20261002153000_editorial_batch_metrics.sql.
6. Apply 20261002154000_class_owner_returning_policy.sql.
7. Apply 20261002155000_class_owner_tenant_boundary.sql.
8. Apply 20261002160000_content_pagination_bounds.sql.
9. Apply 20261002161000_assessment_snapshot_editorial_proof.sql.
10. Apply 20261002162000_rich_content_key_allowlist.sql.
11. Apply 20261002163000_editorial_contract_bounds.sql.
12. Apply 20261002164000_validator_json_aliases.sql.

These eleven migrations were applied to the current live project during this run.
Do not blindly db push older local migrations: historical filenames and deployment
receipts must be reconciled first. Existing backup SQL files are not migrations
for automatic deployment and are not included in the new commits.

Before another environment is upgraded, take an authorized schema/data backup
using the deployment operator's established Supabase backup procedure. Infrastructure
backup configuration and an actual restore drill have not been verified here.
Never put database URLs, credentials or answer-bearing production dumps in Git.

Question batch replay: retain original {spec,candidates} JSON, run validate and
import without --apply, then import --apply. Identical replay returns the existing
batch. Changed input with an existing external ID is rejected rather than overwriting
content. Original staging and question_versions provide recovery evidence.

Fixture recovery is separate from production import. seed:dev-acceptance restores
only DEV_ACCEPTANCE_FIXTURE data through an explicitly authorized server operator.
Do not reseed as part of normal content operations. Factory pilot live tests replay
their labeled batches idempotently. The current implementation provides no general
delete/reset CLI, intentionally avoiding a production-wipe command.

Rollback is not a DROP TABLE recipe. Archive/withdraw affected content through the
review workflow. Do not discard question_versions or alter historical snapshots.
Database authorization changes require an audited forward migration, never a blanket
RLS disable. Restore a backup only after impact and writes since the backup are reviewed.

Local/acceptance operator configuration belongs in ignored environment files.
Production uses only public Supabase URL/anon key in browser configuration.
Service-role values remain server-only; startup rejects a public secret/service key.

Remaining readiness work: real academic review/production questions, provider execution
worker if AI generation is required, password protection configuration, remaining
legacy security-definer privilege audit, vulnerable import/build dependencies, and
the follow-ups explicitly listed in question-factory.md.
