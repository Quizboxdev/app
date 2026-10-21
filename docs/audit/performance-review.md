# Performance and reliability review (Phase 7)

**Status: NOT RUN.** No isolated environment with representative data was available, and load on production is not allowed without approval. No numbers are reported because none were measured.

What was observed without load

* Public pages are served from Vercel's cache (`X-Vercel-Cache: HIT`, ISR `revalidate` 30 to 60 seconds); `/` is `private, no-store` (dynamic).
* Challenge and price lists are limited (48 rows per page), good for scalability.
* Question draw uses `order by random()` over a filtered set, fine at current sizes; revisit above about 100,000 active questions per topic.
* Analytics refresh and cron jobs are idempotent by design (per tests); concurrency behaviour under parallel submissions was not tested.

Plan for a proper pass (on Preview with seeded data): measure Core Web Vitals with Lighthouse on `/`, `/pricing`, `/practise`; time the five most used RPCs with `explain analyze`; run 50 concurrent quiz submissions against one assessment and check scores and attempts are consistent; import a 5,000-row batch and time it; confirm indexes for `attempts`, `responses`, `challenge_attempts`, `coin_transactions`.
