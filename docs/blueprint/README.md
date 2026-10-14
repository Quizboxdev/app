# Extension blueprint: Phase 0 reconnaissance

Source: `QuizBox_Extension_Architecture_Blueprint_v1.0.docx`. Gate decision (2026-10-08): stabilise the education core before building Challenges. This folder is the allowed Phase 0 work: it changes no code.

| Artifact | File |
|---|---|
| Current architecture | CURRENT_ARCHITECTURE.md |
| Domain map | DOMAIN_MAP.md |
| Route map | ROUTE_MAP.md |
| Data flow | DATA_FLOW.md |
| Extension boundaries ADR | ADR-001-extension-boundaries.md |
| Migration plan | MIGRATION_PLAN.md |
| Test matrix | TEST_MATRIX.md |

Written 2026-10-14 from branch `release/public-homepage-hardening`. Facts are from code, schema or config. Anything not found there is marked **UNKNOWN** and needs an ADR, never a guess (blueprint section 2.2).

## Headline findings
1. **Much of the blueprint's backend already exists under another name.** The sponsor competition engine (`quizbox_competition`: documents, chunks, drafts, candidates, bank_items, registrations, participations, leaderboard, snapshots, official_results) is the nearest thing to Campaign + ContentAsset + QuestionPool + Round. Phase 1 should generalise it, not build beside it.
2. **Name clash.** `quizbox_factory.campaigns` is a question-generation job, not the blueprint's Campaign. A distinct name is needed before any code (ADR-002).
3. **Roles are single-valued today** (`public.qb_role`: student, teacher, admin, sponsor on `profiles.role`), but `user_capabilities` already carries composable capabilities for reviewers and support. Participant and Campaign Creator capabilities are not defined.
4. **Tenancy exists in part:** `tenant_memberships`, `qb_tenant_role()`, `tenant_id` in 21 migrations, and one shared public tenant (`qb_public_tenant_id()`). No cross-tenant tests exist for campaign data because none exists yet.
5. **Google Sheets / Apps Script is not in the running system.** The repo has no Apps Script integration code. Questions are loaded from verified files through the admin loader, so the blueprint's "legacy adapter" is a data-import concern (the 17,000-question triage, tracker L8), not a runtime dependency.
6. **Public discovery has no foundation yet:** no campaign slug, share metadata, QR or catalogue. `app/sitemap.ts` and `app/robots.ts` cover the education site only.
