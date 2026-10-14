# Migration plan (proposed; nothing applied)

Rules: additive only, a rollback file in `supabase/rollback/` for each step, proven on PGlite then Preview, applied to production by the owner.

| Step | Change | Compatibility | Rollback |
|---|---|---|---|
| 0 | Settle ADR-002 to 007; make migrations self-contained (C7) so the chain replays from empty | none | n/a |
| 1 | Capability rows: `participant`, `campaign_creator`, `content_owner`, `campaign_admin` (data only) | additive | delete rows |
| 2 | Campaign domain tables (name per ADR-002): `tenant_id`, status state machine, visibility, unique slug, RLS deny by default | additive | drop tables |
| 3 | `content_assets`, `content_versions`, `content_nodes`, `source_chunks`; immutable once referenced by an approved pool | additive | drop tables |
| 4 | `progression_plans` and `stages`; stage to node link | additive | drop tables |
| 5 | `campaign_id`, `content_version_id`, `source_chunk_ids`, `source_evidence` on question pool rows | nullable columns | drop columns |
| 6 | Server RPCs for lifecycle transitions (publish, pause, complete) with idempotency keys and audit | additive | drop functions |
| 7 | Event table and the 17-event taxonomy beside `learning_events` | additive | drop table |
| 8 | Public discovery view (anonymous select, public campaigns only); noindex rule for unlisted | additive | drop view |
| 9 | Tenant branding and domain columns | nullable | drop columns |

## Sequencing against the gate
Steps 1 to 4 and 6 are the order set on 2026-10-08: roles, then the campaign domain on the sponsor engine. No step starts before the education gate (C1 to C5, D5 to D8, A10) is met.
