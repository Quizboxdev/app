# Help article: Canvas 11 evidence

Scope: `/help/[slug]`, stacked on the Help centre branch. Uses the same default-off `flags.design_v02_help` setting. No migration, permission, pricing or deployment change.

## Behavior preserved

Published article content remains sourced through `qb_help_get`. The original plain-text renderer, safe-link rules, heading normalization, related-article contract, feedback/view tracking, metadata, static parameters and `notFound()` behavior are retained. Table-of-contents entries derive from the actual article headings. There are no sample articles, reading-time estimates or invented publication statuses. The displayed update date stays `[date]`, as required by the handoff.

An additional reader distinguishes RPC failure from a missing article. Failure renders the approved recoverable error panel; a null result still uses the existing not-found behavior. A null result cannot establish that an article is unpublished, so that more specific state remains blocked by the backend contract.

## Actual local validation

- Focused article/data-boundary tests: **7 passed**.
- Typecheck, ESLint and production build: **passed**.
- Complete Vitest regression: **1,540 passed, 119 skipped**, across 186 passing and 6 skipped files. Database integration tests use isolated local databases; no hosted migration was applied.
- Local browser fixture content is visibly labelled `QA fixture:` and is not imported by application routes.
- All six measured CSS viewports (1440, 1024, 768, 390, 360, 320) have no horizontal document overflow. Both enabled and legacy presentations have one page heading and use actual returned article data. Measurements are stored with the screenshots.
- Keyboard Tab shows a solid blue outline on article navigation. The first-section anchor lands approximately 96 pixels below the top of the viewport, clear of the sticky header.
- The existing Yes feedback action displays its confirmation against the local test backend.
- Targeted text audit: **26 visible text elements**, minimum **4.76:1**, none below 4.5:1. This is not a blanket WCAG certification.
- A failed article RPC displays We could not load this article with Try again. An invalid slug displays the existing We could not find that page view. No unpublished claim is inferred.

## Screenshot evidence

Original JPEG bytes are retained without image editing. Desktop after captures include the full page; other captures use the visible viewport because full-page capture failed intermittently in the browser tool. Browser scrollbars and device rounding mean raster dimensions can differ from the measured CSS viewport; the JSON records the actual CSS dimensions.

Before means the unchanged legacy article presentation with the flag off, on the same codebase and synthetic article set. The shared narrow-footer wrapping fix applies to both states.

| CSS width | Before | After |
| --- | --- | --- |
| 1440 | [JPEG](evidence/help-article/article-before-flag-off-1440.jpg) | [JPEG](evidence/help-article/article-after-1440.jpg) |
| 1024 | [JPEG](evidence/help-article/article-before-flag-off-1024.jpg) | [JPEG](evidence/help-article/article-after-1024.jpg) |
| 768 | [JPEG](evidence/help-article/article-before-flag-off-768.jpg) | [JPEG](evidence/help-article/article-after-768.jpg) |
| 390 | [JPEG](evidence/help-article/article-before-flag-off-390.jpg) | [JPEG](evidence/help-article/article-after-390.jpg) |
| 360 | [JPEG](evidence/help-article/article-before-flag-off-360.jpg) | [JPEG](evidence/help-article/article-after-360.jpg) |
| 320 | [JPEG](evidence/help-article/article-before-flag-off-320.jpg) | [JPEG](evidence/help-article/article-after-320.jpg) |

Additional captures cover keyboard focus, corrected narrow footer, article RPC failure and invalid-slug not-found behavior. Raw measurements and text-contrast results are included in the same evidence folder.

## Changed files and readiness

Route: `app/(public)/help/[slug]/page.tsx`. Presentation: `components/help/PublicHelpArticle.tsx`, its CSS module, and `components/help/HelpArticleError.tsx`. Data boundary: `lib/help/presentation.ts`. Tests: `components/help/PublicHelpArticle.test.tsx`, `lib/help/presentation.test.ts`. Local fixture: `scripts/qa/fixtures/help.ts`. This report and its evidence complete the inventory.

Status: default-off, draft review only. Production activation, live content acceptance and the remaining design routes are not established by these local checks.
