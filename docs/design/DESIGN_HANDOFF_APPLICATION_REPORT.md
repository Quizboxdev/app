# QuizBox Design Handoff Application Report

## Source
`docs/design/QuizBox-Design-Handoff/QuizBox-Design-Handoff` (design system frozen at 1791196207-241a, 5 Oct 2026).

## Design structure found
- `design-system/`: tokens.json, qb-tokens.css, bundle.css, bundle.js (React 18 components on `window.QuizBox`), ~125 component folders, DM Sans + Sora fonts, Lucide icons, logos, README (rules) and CHANGELOG.
- `canvases/`: 00 foundations/auth/wallet (530 files), 03 student, 04 teacher, 05 school + SME, 08 admin/curriculum. Generated `.dc.html` boards, treated as reference only.
- `previews/`: 1440 / 390 JPEGs per board. `docs/`: expansion plan. `index.html` + `tools/serve.js`: local viewer.
- No conflicting versions of the same board were found; the README says the boards are current and some previews predate text edits.

## Approach
The app has one global stylesheet (`app/globals.css`, no Tailwind) that every page already composes. Remapping its tokens and shared classes restyles all domains at once with minimal churn. Generated canvas/runtime code was not copied.

## Reused existing components
AppShell, BrandLockup (logo unchanged), StatusBadge, StatCard, DashboardHero, RecordTable, charts (MasteryBar/Ring, TrendChart, DistributionBars), achievements, MarketContextControl, WorkspaceProvider/useWorkspace, all existing pages.

## Extended components / styles
- `app/globals.css`: canonical design tokens (colour, radius, role accents, fonts, layout, scrim/overlay) with **legacy variable names kept as aliases**, so existing pages are untouched. Buttons, inputs (`line-control` borders, 12px radius), nav active state (blue-tint), workspace label, avatar ring, pills (new purple/amber/teal/illustrative tones), tables, option/selected states, tracks, skeleton, mobile bottom bar (64px) and 44px touch targets. Dashboard hero is now a white card with a 4px role rule (replaces the dark-blue gradient). Sora is used for display text; DM Sans for body.
- `components/AppShell.tsx`: `data-role` accent (student/teacher/school/sme/sponsor/admin); student nav wording follows the design (Assess, Assignments, Progress, Compete) on existing routes.
- `components/achievements/LeaderboardPodium.tsx`: hard-coded hex values replaced with tokens.
- `components/dashboard-reference.test.ts`: palette assertions updated to the new tokens.

## New components created
- `components/WorkspaceChip.tsx`: design "context chip" bound to the existing workspace API (`useWorkspaceContext` / `switchWorkspace`); it offers switching only when the identity holds more than one workspace and fails soft before the core migration.

## Screens/routes updated (via shared tokens/classes)
All `(app)` routes inherit the new look: /student, /student/assessments, /student/classroom, /student/results, /student/attempt/[id] (question player), /competition/*, /teacher/*, /school, /review, /sponsor, /admin/*, /account, /notifications; plus /login and the other auth pages. Layout and structure of individual pages were **not** reworked.

## Assets reused
Existing QuizBox logo/lockup kept. Added `public/fonts/` (DMSans-latin, DMSans-latin-ext, Sora-latin woff2) from the handoff. Icons: the app already uses lucide-react, which is the same set the design specifies, so the handoff SVGs were not duplicated.

## Design gaps (not applied)
- Student **Learn**, **Practise**, **Wallet**, Offline/download, Achievements and Curriculum Explorer screens have no existing routes in the app (wallet/payment logic exists only in `lib/api/core.ts`, `lib/core/payments.ts`). No routes or fake UI were invented.
- Student Home is not yet restructured to the design's layout (Continue card, Today's goal, Up next, My subjects with completion vs mastery bars, QPoints and Coins cards). It needs page-level work with real data bindings.
- The question player uses existing response types only; design types without code support (matching, ordering, fill-blank, numeric, passage, audio/video, practical evidence) are not rendered.
- Teacher, School, SME and Admin pages keep their current structure; design-specific components (ClassCard, QuestionItem, ReviewChecklist, ApprovalLevel, ScopeBadge, CapabilityRow, AccommodationCard, LifecycleBadge, MasteryBadge, ProficiencyBands) were not added yet.
- Auth screens: only the visual layer changed. The design's extra states (invitation, minor consent, school-code PIN, device sessions) depend on flows that are not all present.
- Guardian, Sponsor-funding, Competition and Leaderboard UI were not applied (the handoff says to build them from existing patterns).

## Backend blockers
- Wallet/Coins/QPoints/payment screens need page routes plus the provider adapter (payments foundation only).
- Unsupported player response types; guardian UI backend; accommodations, capability-grant and curriculum-version approval UIs depend on services not confirmed in this pass.

## Deferred
Page-level restructuring of Student Home, and component additions listed above. Legacy hard-coded hex values elsewhere in page-level inline styles were not swept.

## Verification
- `tsc --noEmit`: clean. `eslint components app/layout.tsx`: 0 errors (1 pre-existing unused-import warning). `vitest run`: all pass after updating one palette assertion. `next build`: succeeds.
- Visually checked: /login at 1440px only (fonts, tokens, buttons, inputs render). The 390px capture was clipped by headless Edge's minimum window width, so it is **not** a valid mobile check.
- **Not visually verified**: any authenticated route (Student Home, Learn/Practise, Question Player, Results, Wallet, Teacher Home, Question Bank, Assignment Builder, School Home, SME Review, Admin Home), at any width. `.env.local` points at production, so I did not sign in.
