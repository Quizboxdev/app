# Domain map: blueprint entity to what exists

| Blueprint entity | Nearest existing structure | Gap or decision |
|---|---|---|
| Tenant | `institutions`, `tenant_memberships`, `qb_public_tenant_id()` (shared public tenant) | Tenant vs institution relationship needs an ADR. No branding or domain fields. |
| Workspace | none | Probably unnecessary on day one (ADR-002). |
| Campaign | `quizbox_competition` (competition with sponsor, dates, registrations). Not `quizbox_factory.campaigns` | Name clash. New table or generalise competition (ADR-002). |
| CampaignCategory | none | One config or enum source; the blueprint forbids hard-coding in frontends. |
| CampaignOwner, Sponsor, Content Owner | `sponsor_organizations`, `organization_members` | Content owner and creator are not separate concepts today. |
| ContentAsset, ContentVersion | `competition.documents`; `quizbox_sources.registry` and `source_documents` (curricula) | Competition documents are not versioned; curriculum sources are (immutable once approved). |
| ContentNode, SourceChunk | `competition.chunks`; `curriculum_nodes` (curricula only) | A generic node tree for books and policies is missing. |
| ProgressionPlan, Stage | none | New. The curriculum hierarchy is the only progression model. |
| QuestionPool | `competition.bank_items`; `questions` with the topic registry (50 per indicator) | Confirm how `snapshots` version a pool. |
| Question record (7.3) | `questions` with `source_type`, `content_origin`, `validation_status` | Missing: tenant_id, campaign_id, content_version_id, source_chunk_ids, source_evidence, model_metadata. Evidence lives in loader files, not the row. |
| CompetitionRound | `participations`, `snapshots`, `official_results`, `leaderboard` | Rounds, stages and advancement are not modelled. |
| RewardPlan | `wallets`, coins, `access_entitlements`; prizes as text | No fulfilment status or reward plan. |
| DiscoveryProfile | none | New: slug, visibility, SEO, share image. |
| Analytics events | `learning_events`, `quizbox_factory.events`, `quizbox_sources.events`, `audit_logs` | No single taxonomy; the 17 blueprint events are not emitted. |
| Participant | `profiles` and `student_profiles` | A non-student participant has no profile type; `profiles.role` is single-valued. |
| CampaignParticipation | `competition.registrations`, `participations` | Team and institution oriented; individual public participation not modelled. |

## Capabilities (blueprint 4.3)
Not defined: Participant, Campaign Creator, Content Owner, Campaign Administrator, Tenant Administrator. Existing: student, teacher, admin (owner), sponsor, reviewer capabilities (`sme_*`) and `sme_support`.
