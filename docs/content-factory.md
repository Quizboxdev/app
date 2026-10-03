# Content Factory and SME Workforce

Migration: `20261005100000_content_factory.sql` (rollback: `supabase/rollback/content_factory.sql`).
Pages: **Admin → Content Factory** (`/admin/content-factory`) and **Admin → SME Workforce** (`/admin/sme-workforce`). Content Admin or Super Admin only.
SMEs see their own workload on `/review` ("My review workload").

The Content Factory produces QuizBox-owned curriculum content. Sponsor competition generation stays in the Sponsor Workspace.
Both use the same configured generation adapter, but their interfaces and data are separate.

## What it reuses (no parallel engines)

| Concern | Existing component |
|---|---|
| Generation | `generateQuestions` (`lib/content/factory/generation.ts`) after `qb_resolve_generation_sources` re-authorizes market, curriculum and sources |
| Persistence and validation | `quizbox_private.core_qb_content_ingest`: structural validation, hash de-duplication, `review` state, never auto-approved |
| Market and source governance | `quizbox_market.validate_context` and the question guard, using an explicit LOCAL_MARKET / CURRICULUM_ALIGNED content context restored after each job |
| Review | `qb_sme_assign_review` (domain match and compensation policy) and `qb_sme_complete_review` (immutable event and earnings) |
| Publication | Unchanged and separate (`qb_sme_publish_question`) |

## Campaign lifecycle

1. **DRAFT.** The admin chooses the market and an active curriculum with an authority. Approved curriculum sources must belong to that curriculum and market; country curricula are never mixed. The admin also sets levels, grades, subjects, optional strand/topic/indicator codes, the target, batch size, difficulty, cognitive and type mixes (each totals 100%), the provider and model, the review policy and the safety limits.
2. **Distribution plan.** The target is split per indicator (equal, or favouring coverage gaps), then into difficulty × cognitive × type cells using largest-remainder apportionment. The admin can adjust rows. The campaign becomes **READY** only when the plan total equals the target.
3. **Estimate.** Shows jobs, executions, provider calls, tokens (only when `review_policy.tokens_per_question` is configured), and primary and senior review volume. No currency cost is shown without provider pricing.
4. **Start (RUNNING).** Creates jobs, one or more per plan row and each at most the batch size, capped at 20,000 per campaign. Campaigns at or above `large_campaign_threshold` require the campaign name to be typed.
5. **Run.** Each click is one bounded execution of at most `max_jobs_per_execution` (≤ 10) jobs, run sequentially server-side through `POST /api/admin/content-factory/run`. Generation runs inside the caller's content context, so the admin's active market must be the campaign's market.
6. **Failures.** A failed job is retried up to `retry_limit`. After `pause_failure_threshold` consecutive failures the campaign auto-pauses. A campaign ends **COMPLETED** when no jobs remain, or **FAILED** if none succeeded.
7. **Other controls.** Pause and resume generation, stop and resume SME assignment, and cancel remaining jobs. Cancelling keeps every generated and reviewed question.

### Duplicates

- **Exact normalized duplicates of existing questions are not accepted into the review pool.** They are recorded on the job (`duplicates_skipped`), and the existing question is never modified. This also prevents a duplicate of out-of-context legacy content from failing the whole job.
- **Near-duplicates are flagged, never deleted.** These are Jaccard similarity ≥ 0.85 against the indicator's existing questions, plus answer and option-signature collisions; they get a `duplicate_group_id`.

## Workforce

**Workload policies** are set per reviewer by a Super Admin. A policy covers:
- market, subject, grades, level and primary/senior kind;
- the mode: `FIXED_DAILY`, `TOP_UP_QUEUE` (recommended) or `CAMPAIGN_ALLOCATION`;
- daily limit, target and maximum open queue, and working days (in the market timezone);
- optional campaign, priority, effective dates and pause.

A policy must fall inside an active reviewer domain, and it can never widen authorization.

**The scheduler** (`run_scheduler`) runs manually now; it can be called from a cron job later with the same RPC. Under an advisory lock it:
- computes each reviewer's capacity from live assignment state;
- selects eligible questions by campaign priority;
- assigns them through `qb_sme_assign_review` and logs an immutable `assignment_events` row.

Because capacity comes from live state, re-running assigns nothing to a full queue. The unique open-review index prevents double assignment.

**Capacity management.** Admins can pause or resume a reviewer, change limits, change campaign priority, allocate campaign quotas by configured capacity, and reassign outstanding work. A released assignment closes without a review event, so it never becomes payable. All of these changes are audited in `quizbox_factory.events`.

**Assignment ≠ payable.** Earnings are created only by completed reviews with a resolved compensation policy. Quality indicators (QA reversal rate, revision rate, disputes, average review time) are shown beside volume.

## Import and manual authoring

`qb_content_factory_import` accepts at most 500 rows, from CSV or JSON, or a single hand-authored question.
- **Validation:** market, curriculum, indicator, subject and grade, a source reference (provenance) and answer format.
- **Provenance:** imported rows are `IMPORTED` and hand-authored rows are `HUMAN_AUTHOR`. The author is the batch's `imported_by`, kept separate from `AI_GENERATED`.
- **Result:** every accepted row enters `review`, and nothing is published.

## Generation adapter contract

The adapter uses the same environment variables as the sponsor engine: `QUIZBOX_GENERATION_PROVIDER`, `QUIZBOX_GENERATION_MODEL`, `QUIZBOX_GENERATION_ENDPOINT` and the optional `QUIZBOX_GENERATION_API_KEY`.
- **Request:** `POST { kind: "curriculum", prompt, spec }`.
- **Response:** a JSON array of exactly `spec.count` curriculum candidates.

Production stays disabled until this is configured. Never point production at the branch mock provider.

## Known limits

- Fine-grained mixes over many indicators create many small jobs. For example, 50,000 questions across about 1,500 indicators with 12 cells averages under 3 questions per job. Use broader mixes or a larger scope per campaign.
- Ingest keeps its own 10-per-minute batch limit per admin. A job that hits it is re-queued, not failed.
