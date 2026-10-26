# Help centre: Canvas 11 evidence

Scope: `/help` only. Base implementation is `integrate/design-v02` (`6ee40fc`); the Help branch is stacked on the isolated Windows rollback-test correction. No hosted settings, permissions, migrations, prices or deployments were changed.

## Implementation

`flags.design_v02_help` uses the existing global platform-settings architecture and defaults to false. Missing, invalid or unreadable settings retain the legacy page. The original HelpHome component and legacy reader are unchanged. The enabled page reads the same `qb_help_list` and `/api/help/search` contracts; the new reader distinguishes a successful empty library from an RPC failure. Search cancellation prevents an obsolete response replacing a cleared query. Support contacts remain visible bracketed placeholders.

A shared footer CSS correction lets its existing tagline wrap when a Windows scrollbar narrows the available space at 320 pixels. This applies in both flag states; no product text or link destination changes.

Canvas 11 was inspected in the authenticated browser at the supplied artifact URL. The HelpCentre, mobile HelpCentre and PublicStates boards informed this implementation. Existing repository categories differ from the illustrated categories: only actual categories containing published articles are offered, and counts/popularity come from returned records. No example articles, guardian guides or popularity figures are added to the application.

## Actual local results

- Typecheck and ESLint passed before the final complete regression run.
- Focused Help tests: 6 passed, covering default-off/invalid/error flags, content failure versus empty state, actual category counts/popularity and placeholder contacts.
- Complete Vitest regression: **1,536 passed, 119 skipped**, across 185 passing and 6 skipped files. Existing database integration suites run against isolated local databases; no hosted migration was applied.
- Production build: **passed**, including compilation, type/lint validation and all 127 generated static pages. The build used the repository's existing missing-server-configuration fallbacks; it does not establish live Help availability.
- Browser checks used a local Next.js server and the existing local fake-Supabase harness. Every article is labelled `QA fixture:`. These screenshots establish presentation behavior, not live content availability or authenticated production readiness.

## Browser acceptance

| Check | Actual result |
| --- | --- |
| Responsive flagged page | CSS viewports 1440, 1024, 768, 390, 360, 320: no horizontal overflow. Raw measurements: [responsive.json](evidence/help/responsive.json). |
| Flag-off | Same six widths render the legacy `Help` heading; the new component is absent. No horizontal overflow. [flag-off.json](evidence/help/flag-off.json). |
| Keyboard focus | Tab from search reaches the first topic; a solid blue focus outline is visible. [Focus screenshot](evidence/help/help-focus-390.jpg). |
| Text contrast | 29 visible text elements in the new content measured; minimum **4.76:1**; no result below 4.5:1. [contrast.json](evidence/help/contrast.json). This is a targeted text audit, not a blanket WCAG certification. |
| Topic selection | Getting started selects its actual article and displays an All topics recovery action. |
| Successful search | Searching `recovery` displays the matching account article. |
| Search failure | A failed RPC displays a retry action while browse topics remain available. [Screenshot](evidence/help/help-search-error-390.jpg). |
| Empty search | An unmatched query displays a clear-search action, which restores browsing. [Screenshot](evidence/help/help-search-empty-390.jpg). |
| Empty library | Successful empty data displays No articles available yet, with no invented popular articles. [Screenshot](evidence/help/help-library-empty-390.jpg). |
| Library failure | A failed list RPC displays Help articles could not load and Try again, distinct from empty content. [Screenshot](evidence/help/help-library-error-390.jpg). |

The browser applies pixel rounding at some viewport overrides; the measurement files record the observed CSS width. Original JPEG captures are retained without resizing or image edits.

## Before / after

Before screenshots run the actual unchanged legacy branch of the route with the new flag absent. After screenshots run the flagged presentation with the same synthetic article set.

| CSS width | Before (flag off) | After (flag on) |
| --- | --- | --- |
| 1440 | [JPEG](evidence/help/help-before-flag-off-1440.jpg) | [JPEG](evidence/help/help-after-1440.jpg) |
| 1024 | [JPEG](evidence/help/help-before-flag-off-1024.jpg) | [JPEG](evidence/help/help-after-1024.jpg) |
| 768 | [JPEG](evidence/help/help-before-flag-off-768.jpg) | [JPEG](evidence/help/help-after-768.jpg) |
| 390 | [JPEG](evidence/help/help-before-flag-off-390.jpg) | [JPEG](evidence/help/help-after-390.jpg) |
| 360 | [JPEG](evidence/help/help-before-flag-off-360.jpg) | [JPEG](evidence/help/help-after-360.jpg) |
| 320 | [JPEG](evidence/help/help-before-flag-off-320.jpg) | [JPEG](evidence/help/help-after-320.jpg) |

## Files and readiness

Application: `app/(public)/help/page.tsx`, `app/(public)/public.css`, `components/help/HelpCentre.tsx`, `components/help/HelpCentre.module.css`, `lib/help/presentation.ts`, `lib/core/config.ts`.

Tests: `components/help/HelpCentre.test.tsx`, `lib/help/presentation.test.ts`. Browser harness: `scripts/qa/fixtures/help.ts`, `scripts/qa/help-server.ts`.

Documentation: unchanged supplied handoff files, BLOCKERS.md, IMPLEMENTATION_PLAN_CANVAS11.md, this report and the evidence directory.

Release remains **default-off / review only**. Other requested routes and phases are not included in this PR. Shared PublicHeader/PublicFooter and existing destinations are reused intact. No secret values are included in this report.
