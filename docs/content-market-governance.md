# Multi-country content governance

## Required boundary

Market/country is the primary content-governance boundary, independent of
currency and localization. Every content workflow resolves:

**User -> Market -> Curriculum Authority -> Curriculum -> Subject ->
Grade/Level -> Approved Source Corpus.**

Missing context fails closed. A country must not be inferred from currency,
language, a grade alias, or the first curriculum in an unscoped catalogue.
Selecting a market does not itself approve a source or confer tenant access.
Existing Auth, RLS, role, tenant and assessment answer-hiding checks remain
mandatory in addition to this boundary.

## Scope and source selection

| Scope | Market selection | Source selection |
| --- | --- | --- |
| `local_market` (default) | Exactly one authorized market | Approved sources within that market |
| `selected_multi_market` | At least two explicitly authorized markets | Explicit approved sources within the selected markets |
| `global` | Explicit global mode, not a fallback | Explicit approved sponsor documents or harmonized concept packs; national curricula cannot be selected directly |

Every national curriculum corpus carries its exact market, authority and
curriculum identity. Document and concept-pack permissions must also be
verified on the server. A global flag is not an authorization bypass.

Sponsor competitions support all three source modes:

- `curriculum_aligned`: selected approved curriculum corpora or concept packs.
- `sponsor_document`: explicitly selected, authorized approved sponsor documents.
- `hybrid`: both source families, retaining provenance separately.

Competition source mode and geographic scope are independent selections.
Binding a competition must persist its explicit context; participation must
use that bound context rather than implicitly widening a participant's default.

## Workflow requirements

| Workflow | Required resolution |
| --- | --- |
| AI generation | Server validates market, authority, curriculum, subject, level and approved corpus before a provider call; output retains provenance |
| Curriculum navigation | Queries and RPCs expose only the current context; changing market clears incompatible selections |
| Teacher assignment | Class curriculum, selected objectives and approved questions must agree with the resolved context |
| Student practice | Available assessments and attempt creation use the resolved context; attempts retain the context used at creation |
| SME review | Reviewer domain authorization AND content context; no cross-market access by navigation alone |
| Sponsor competition | Explicit scope, source mode and source IDs; server validates before generation or publication |

National curriculum codes, authorities, node identities and source labels remain
independent and unchanged. Cross-country harmonization is a separate, reviewed
mapping layer with provenance, not a rewrite or deduplication of national nodes.
Source grade `B10` and canonical learner level `SHS1` remain separate identities;
the canonical equivalence does not merge national curricula.

## Implementation and activation status

`20261002210000_content_market_enforcement.sql` is the additive enforcement
migration, following `20261002200000_market_sme_foundation.sql`. Both are
**prepared, not applied to the hosted project**. The server-authoritative resolver
is `quizbox_market.resolve_context()`, exposed through an authenticated RPC.
Application validators are convenience checks, never the authorization boundary.

Restrictive policies AND with existing tenant/role policies. Existing RPC guards
are inserted in place, retaining function identity, defaults, ACLs, budget wrappers
and original bodies. The migration aborts if required contracts or the inspected
queue/coverage/batch query patterns have changed. The legacy assignment overload
continues delegating to the canonical overload. No grading or answer-payload RPC
is replaced. Context is snapshotted on new attempts and generation batches.

The existing `source_documents` table is extended rather than duplicated. Approval
requires rights confirmation, checksum, verified text and an approver; national
sources require agreeing authority/market/curriculum identities. There is no
automatic source approval. Approved source text is immutable; its approval can
be revoked without changing provenance. New jobs resolve approved source IDs
before provider invocation and persist scope, source mode, document IDs,
provenance and target audience. The generic prompt has no Ghana-only default.

Ghana compatibility is data-only. Existing profile country attribution and active
tenant memberships supply unambiguous default markets. Existing questions are
attributed only when their curriculum and node agree with an explicitly
country-attributed curriculum; their content, approval and grade labels are not
edited. This is a documented legacy-content exception, not approval of an AI
source corpus. Ambiguous profiles, curricula, questions and unverified source
documents are flagged in `market_attribution_issues`. `GH-SOURCE` has no verified
authority in the live schema and is not silently assigned one. Navigation of
attributed legacy curricula remains available; generation requires authority and
approved source configuration.

The existing provider contract remains indicator-based. Sponsor-document source
mode uses document extracts only; a local indicator supplies the audience target,
not an implicit curriculum source. Global generation requires an explicitly
approved concept/indicator mapping for the chosen pack or document. No global
source selection widens access to an entire national hierarchy.

The existing market admin screen now manages authorities, curricula-by-market,
user/sponsor assignments and existing source document approval. Scope controls
are available there and on the sponsor dashboard. Market switching lists only
authorized markets and reloads data/selections. Source catalogue retrieval is
server scoped; cross-market selection must be explicit. Core curriculum reads
remain RLS-backed rather than trusting URL filters.

Competition generation specifications include `competitionId`. The resolver
verifies the caller is the creator, owning sponsor or Super Admin, resolves the
bound context rather than the caller's unrelated navigation default, and rejects
changes to the bound source set. Existing role checks for queueing/importing
generation jobs remain in place; source resolution does not grant new editorial
publication permissions to sponsors or students.

Local tests apply both migrations to isolated PostgreSQL (PGlite) contract
fixtures and exercise allow/deny paths under `authenticated`. They do not prove
live Supabase configuration, complete production RPC execution, or browser E2E.
See [activation runbook](content-market-activation.md) for the staging and hosted
verification boundary. Until that runbook passes, hosted isolation remains
unverified. No production migration, content mutation, push or deployment has
been performed for this task.
