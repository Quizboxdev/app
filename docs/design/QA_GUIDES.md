# Authenticated Guides: Canvas 11 evidence

Scope: `/guides`, based on the Help centre branch. The existing authenticated AppShell and application sign-in boundary are preserved. The default-off `flags.design_v02_help` setting chooses the new presentation; its off branch retains the original Guides implementation.

## Actual contracts and design adaptation

The new catalogue uses the existing `qb_help_list` RPC and `/api/help/search` endpoint. Initial audience selection reuses `bootstrapUser` and `audienceForRole`; selecting a guide audience never changes workspace roles or permissions. Search remains available, including cancellation of obsolete requests and clear/retry recovery.

Cards display real titles, summaries and supported audience metadata. The approved board contains sample step counts, reading times, Guardian and Reviewer filters. Those fields/audiences are not supplied by the current list/search contract, so they are not fabricated. Supported filters are All guides, Learners, Teachers, Schools and Sponsors. The board's public header is adapted to the protected AppShell instead of making the route public.

Loading uses a labelled skeleton; successful empty data and failed reads have distinct states. Tab controls support arrows, Home and End with roving focus and a labelled tab panel. The layout uses frozen DS tokens and the board's 300-pixel card minimum, constrained to fit narrow screens.

## Validation record

Typecheck, ESLint and production build: **passed**. Complete Vitest regression: **1,544 passed, 119 skipped**, across 188 passing and 6 skipped files. Focused catalogue, local-session and search-cache tests: **8 passed**. Database integration suites use isolated local databases; no hosted migration was applied.

The transient-error browser case exposed the existing search endpoint caching failures for 30 seconds. Error responses now use `Cache-Control: no-store`; successful responses retain their existing 30-second cache and audience argument. The running browser then recovered immediately through Try again. This shared correction also benefits the existing Help search without changing its response data or permissions.

Browser evidence uses the local fake-Supabase harness. Names and records are explicitly labelled QA Student, QA Teacher and QA fixture. A test-only loopback endpoint establishes the same synthetic session as the existing CLI harness; it is not an application route and never contacts a hosted project. Unit tests check its loopback restriction and asynchronous RPC results/errors. This verifies presentation under fixture sessions, not production RLS or live identity acceptance.

The initial signed-out `/guides` visit redirected to `/login`. After a synthetic Student session, the protected page selected Learners and displayed only the audience-eligible guides.

| Browser case | Actual result |
| --- | --- |
| 1440 / 1024 / 768 / 390 / 360 / 320 | New catalogue and document fit without horizontal overflow. [Measurements](evidence/guides/responsive.json). |
| Flag off, same six widths | Legacy Help heading and original Guides presentation; new catalogue absent; no horizontal overflow. [Measurements](evidence/guides/flag-off.json). |
| Keyboard | ArrowRight selected Teachers and moved focus; Home selected All guides; End selected Sponsors. [Focus evidence](evidence/guides/focus.json). |
| Focus visibility | Solid blue outline on the focused role tab, visible below the header. [Capture](evidence/guides/guides-focus-320.jpg). |
| Bottom navigation | The last card scrolled fully into view, above the fixed mobile navigation. [Measurements](evidence/guides/last-card.json). |
| Contrast | 18 text samples including the search placeholder; minimum **4.55:1**, none below 4.5:1. [Results](evidence/guides/contrast.json). This is a targeted audit, not blanket WCAG certification. |
| Teacher default | Teachers selected; Teacher guide returned; existing in-app reader opened its actual fixture body. [Reader capture](evidence/guides/guides-existing-reader-390.jpg). |
| Loading | Pending list read displayed a labelled skeleton. [Capture](evidence/guides/guides-loading-390.jpg). |
| Empty versus error | Successful empty list and failed list rendered different states. [Empty](evidence/guides/guides-empty-390.jpg), [error](evidence/guides/guides-list-error-390.jpg). |
| Search | Teacher-filtered search returned the Teacher guide; empty search cleared back to the list; persistent errors displayed retry. [Search success](evidence/guides/guides-search-success-320.jpg), [empty](evidence/guides/guides-search-empty-320.jpg), [error](evidence/guides/guides-search-error-320.jpg). |
| Retry recovery | A fresh transient failure recovered to eligible results after Retry. [Capture](evidence/guides/guides-retry-recovered-390.jpg). |

### Before / after

| CSS width | Flag off | Flag on |
| --- | --- | --- |
| 1440 | [JPEG](evidence/guides/guides-before-flag-off-1440.jpg) | [JPEG](evidence/guides/guides-after-1440.jpg) |
| 1024 | [JPEG](evidence/guides/guides-before-flag-off-1024.jpg) | [JPEG](evidence/guides/guides-after-1024.jpg) |
| 768 | [JPEG](evidence/guides/guides-before-flag-off-768.jpg) | [JPEG](evidence/guides/guides-after-768.jpg) |
| 390 | [JPEG](evidence/guides/guides-before-flag-off-390.jpg) | [JPEG](evidence/guides/guides-after-390.jpg) |
| 360 | [JPEG](evidence/guides/guides-before-flag-off-360.jpg) | [JPEG](evidence/guides/guides-after-360.jpg) |
| 320 | [JPEG](evidence/guides/guides-before-flag-off-320.jpg) | [JPEG](evidence/guides/guides-after-320.jpg) |

## Evidence and inventory

The evidence folder contains untouched JPEG viewport captures, measured CSS widths, text-contrast results and loading/empty/error/focus cases. Browser scrollbars and device rounding can make raster dimensions differ from CSS viewport dimensions; no images are resized.

Application files: `app/(app)/guides/page.tsx`, `app/api/help/search/route.ts`, `components/help/GuidesDesign.tsx`, `components/help/GuideCatalogue.tsx`, and `components/help/GuideCatalogue.module.css`.

Tests and harness: `components/help/GuideCatalogue.test.tsx`, `app/api/help/search/route.test.ts`, `scripts/qa/fixture-server.ts`, its test, `scripts/qa/fixtures/guides.ts`, and `scripts/qa/guides-server.ts`. This report, BLOCKERS.md and the evidence directory complete the inventory.

Release status remains default-off and draft-review only. No hosted migration, permission change, pricing change, deployment or merge is performed.
