# Release data verification

Two read-only gates prevent test and demo data from reaching production activation.

1. **Repository gate** — `npm run release:preflight` (no database access). Fails if any migration
   contains test-market, fixture, synthetic-account or preview-branch markers, if environment files are
   tracked, or if migration versions are duplicated/BOM-encoded. Report: `reports/release-preflight.json`.
2. **Database gate** — `supabase db query --linked -f scripts/release-data-verification.sql` against the
   target after migrations and before opening signup. Every row must be `pass = true`:
   * `DEV_ACCEPTANCE_FIXTURE` questions are denied to everyone except the reserved acceptance identities;
   * no `TESTLAND_FIXTURE` questions, no ACTIVE test market, `TEST_MARKETS_VISIBLE` disabled;
   * no `@e2e.quizbox.invalid` accounts; no published demo competitions;
   * `QBTEST` questions stay inactive and unattributed (review-only);
   * `GH-SOURCE` gets an authority only together with recorded source provenance.

Branch-only artefacts live outside `supabase/migrations` (scratch seed files) and are never applied by
`supabase db push`. On the data-cloned branch the database gate intentionally fails the test-market,
fixture and synthetic-account rows — demonstrating that leakage would be caught.
