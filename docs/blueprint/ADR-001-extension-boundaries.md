# ADR-001: Extend the shared core; do not fork

- Status: PROPOSED, for owner sign-off (matches blueprint AD-01, AD-02, AD-04, AD-08, AD-12)
- Date: 2026-10-14

## Decision
QuizBox Challenges is built on the existing Supabase backend and identity as a separate surface, not a copied codebase. Education stays the protected core and keeps its routes, RPCs and tests unchanged.

## Boundaries
1. **One identity.** No second user table for public participants. A participant is a `profiles` row; capabilities are added through `user_capabilities`.
2. **One scoring engine.** Challenges reuse server-side attempt scoring.
3. **One question store.** Campaign questions live in `questions` or a generalisation of the competition bank, versioned, and the full pool is never sent to the browser.
4. **Campaigns are new.** The blueprint's Campaign must not reuse `quizbox_factory.campaigns` (a generation job). The name is chosen in ADR-002.
5. **Adapters, not rewrites.** Sheets and Apps Script are a data source for legacy questions (the 17,000-row triage, L8), never the system of record for campaigns.
6. **Generalise the competition engine, do not duplicate it.** Trace `quizbox_competition` first; every change is a migration with a rollback.
7. **Education regression stays green** (TEST_MATRIX) on every phase.

## Consequences
The first pilot is slower but there is no duplicated cost or divergence. Phase 1 starts from `quizbox_competition`, so its production status (sponsor creation OFF) must be settled first.

## Open ADRs
- ADR-002: Campaign entity name and its relation to competition and to `quizbox_factory.campaigns`.
- ADR-003: Surface and domain (subdomain or path), auth redirects, session sharing.
- ADR-004: Capability model (Participant, Creator, Content Owner, Campaign Admin) on `user_capabilities`.
- ADR-005: Tenant vs institution, and the public tenant.
- ADR-006: Content versioning and signed delivery for uploaded books.
- ADR-007: Payments provider (also unblocks the subscription workflow).
