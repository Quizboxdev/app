# QuizBox — end-to-end interface design brief

You are designing the complete interface of QuizBox: every public page and every signed-in screen, for every role, at desktop and phone sizes, with every state a real user will meet. The output is a design canvas that engineers can build from directly: each artboard is named, annotated with the components it uses, and bound to real data fields.

Work from the QuizBox design system, the live homepage and this brief. Where they disagree, follow the decisions in section 3. Do not invent features, business rules, prices, contact details or figures.

---

## 1. Product in one paragraph

QuizBox is a curriculum-aligned learning, assessment and competition platform. Learners practise and take assessments mapped to their country's curriculum (first market: Ghana, GES/NaCCA; built for multiple markets and curricula). Teachers assign work and act on mastery evidence. Schools oversee classes and teachers. Sponsors fund and run governed competitions. Subject-matter experts (SMEs) review every generated question before it reaches learners. QuizBox administrators govern markets, content, competitions, reviewers and payouts. Brand descriptor: **"Learning • Assessment • Competition Platform"**. Ghana and JHS are market and curriculum contexts, not the brand.

## 2. Sources of truth

1. **Design system (primary):** https://claude.ai/artifact/Lq1m6xEsu4RzK6ivsw5CVa. Read `project/README.md` first, then `project/tokens.json` and each `project/components/<Name>/README.md`. Use its tokens, type scale, role-accent rule, honest-data rule, iconography and the 27 components exactly as specified.
2. **Public homepage:** the visual authority for tone and composition. The live sections are: header, hero, role ecosystem, governance, student, teacher, sponsor, SME, schools, content pipeline, competitions, curriculum subjects, final CTA and footer.
3. **This brief:** the screen inventory, roles, flows, states and the decisions below.

## 3. Decisions that override conflicts

The design system and the current code disagree in places. Design to these decisions, and list every place you follow one, so the code can be brought in line.

| Topic | Decision |
|---|---|
| Colour | Use the design-system tokens (`blue` #2563eb, `ink` #0f172a, `red-brand` #dc2626 wordmark only, `green`, `amber`, `purple`, slate neutrals). |
| Error colour | **Add** `red-error` #b91c1c (text, 6.5:1 on white) and `red-error-tint` #fef2f2, with `red-error-line` #fecaca. Use them for validation errors, destructive actions and failed states. Amber stays for warning, pending and illustrative. `red-brand` stays wordmark-only. |
| Type | Sora (display, metrics, wordmark) + DM Sans (everything else), per the system's scale. |
| Density | Dashboards and admin tools are compact: page title 26px (24px under 480px), card titles 16–17px, body 14–15px, table text 13px, metadata 11–12px. Buttons and inputs are **40px** in signed-in screens (44px on touch screens). The system's 48px controls and 50px hero buttons apply to the public site only. |
| Width | Public pages and dashboards: `container` 1240px. Dense admin tables (content operations, SME workforce, payouts, curriculum sources, audit trail) may use the full content width up to 1440px. |
| Workspace hero | Use the system's `WorkspaceHero`: a `blue-tint` panel with a 4px role-accent top rule. Do **not** use the navy gradient hero now in code. |
| Role accent | Touches only the eyebrow, sidebar workspace label, avatar ring and hero top rule. Buttons, links, active nav, charts and badges stay brand blue in every workspace. |
| Logo | App tile + live-text `Wordmark`. Workspace tagline "Learning • Assessment • Competition". The JHS lockup asset is **retired**; never use it. |
| Spelling | British/Ghanaian: *practise* (verb), *organisation*, *programme*, *recognise*. |
| Theme | Light only for this pass. Keep every colour a token so a dark theme can follow. |
| Copy for the admin hero | "Govern the platform. Resolve what needs attention." / "Monitor markets, content quality, competitions, reviewer operations and platform health from one control point." |

## 4. Roles and what each needs

| Role | Workspace | Should feel | Priorities above the fold |
|---|---|---|---|
| Public visitor | Homepage and entry pages | Clear, credible, inviting | What QuizBox is, who it serves, how to join |
| Student | `/student` | Simple, motivating, fast | Next assignment, progress, competitions, achievements |
| Teacher | `/teacher` | Instructional, evidence-driven | Classes, open assignments, submissions, learners needing support |
| School administrator | `/school` | Institutional, monitoring | Classes, teachers, participation, transfers |
| Sponsor | `/sponsor` | Executive, campaign-oriented | Competitions, registrations, completion, reach, reporting |
| SME reviewer | `/review` | A focused workbench | Queue, assigned work, decisions, quality record, earnings |
| Seller (teacher or admin) | `/seller` | Simple commerce | Products, orders, earnings, withdrawable balance |
| Tenant administrator | `/tenant/[id]` | Organisational overview | Members, classes, questions, assessments, learning outcomes |
| Super Admin / Admin | `/admin` | Dense, controlled, operational | Exceptions, approvals, health, throughput, governance |

Capability flags change what a person sees (for example a teacher can also be an SME reviewer or a seller; content, finance and super admins see different admin areas). Design the navigation so extra capabilities appear as extra sidebar groups, never as a separate app.

## 5. The frame: AppShell and navigation

Use the system's `AppShell`, `Sidebar`, `NavItem`, `Topbar`, `Avatar` and `Wordmark`.

- **Desktop (≥1024px):** 224px sidebar with the wordmark at the top, a role-accented workspace label, then grouped navigation. The 64px top bar holds the page title, global search, notifications (with unread count), the market chip, the avatar menu (Account, Sign out).
- **Tablet and phone (<1024px):** a 58px sticky top bar (wordmark, notifications, avatar) and a bottom bar with four primary destinations plus **More**. More opens a bottom sheet listing every section the person can reach, grouped as on desktop. Design the open sheet.
- **Market chip:** a compact pill showing the active market. People authorised for several markets get a dropdown; others see a static chip.
- **Sidebar groups by role:**
  - Student: Home, Assessments, Progress, Competitions, Classroom, Marketplace.
  - Teacher: *Teaching* (Dashboard, Classes, Assignments, Gradebook, Question Banks) · *Explore* (Competitions, Marketplace, Seller if enabled) · *SME* (SME Reviews if a reviewer).
  - Sponsor: Dashboard, Workspace, Competitions, Marketplace.
  - Admin: *Overview* (Dashboard) · *Markets & organisations* (Markets, Market Setup, Tenants) · *Content & curriculum* (Content Operations, Content Factory, Curriculum Sources, Content Quality, Marketplace Governance) · *Competitions* (Competition Operations, Assignments, Oversight) · *SME & payments* (SME Reviews, Reviewers, SME Performance, SME Workforce, Compensation, Payouts) · *Operations* (Platform Operations, Support) · *Marketplace* (Catalogue, Seller).
  - Phone bottom bar, first four: Student (Home, Assessments, Progress, Competitions), Teacher (Dashboard, Classes, Assignments, Gradebook), Sponsor (Dashboard, Workspace, Competitions, Marketplace), Admin (Dashboard, Content Operations, SME Reviews, Platform Operations).

## 6. Screen inventory

Design every screen below at **1440px** and **390px**. For each screen, show the default state with realistic data, plus the states listed in section 7. Data shown is real field data from QuizBox (names, scores, curriculum codes like "GH-CCP-2020", indicator codes, subjects such as Computing, Mathematics, English, Science). Never show raw UUIDs or machine timestamps: short references and formatted dates only.

### 6.1 Public

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/` | Homepage (already built; restyle to the system and use it as the benchmark) | Get started / role CTAs |
| `/login` | Sign in: email, password, forgot password, switch to create account | Sign in |
| `/login?mode=register` | Country-first registration: full name, country (only available markets), role (student, teacher, sponsor), email, password. Deep links preselect role, country and SME intent. SME intent shows a note that SME review is applied for after creating a teacher account. | Create account |
| `/auth/forgot-password`, `/auth/reset-password` | Request and set a new password, with success and expired-link states | Send link / Save password |
| `/onboarding` | Role-specific setup after signup: student grade and education level; teacher subjects, grades and an optional "apply to review content as an SME"; sponsor organisation basics | Finish setup |
| `/join/sponsor` | Who can sponsor, what sponsors do, "Registration is not approval" | Begin sponsor onboarding |
| `/join/sme` | Teacher SME application entry and how compensation works ("Assigned work is not payable until reviewed") | Start a teacher SME application |
| `/join/school`, `/join/country` | Interest pages; the forms are **disabled** with "Expression of interest form coming soon" | — |
| `/contact` | Routing cards (sponsor, school, SME, account support) plus a disabled enquiry form | Route to the right page |
| `/privacy`, `/terms` | Placeholder notice only ("…is being finalised. Please contact us…"); never invent legal text | — |

### 6.2 Student

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/student` | WorkspaceHero (greeting with first name, next assignment); metrics (assessments completed, average score, assignments to do, competition rank or "—"); upcoming assignments; subject mastery; overall mastery donut; performance trend; competition leaderboard; achievements | Start next assignment |
| `/student/assessments` | Assigned and available assessments with subject, due date, mode (assessment or practice), attempts left | Start |
| `/student/attempt/[id]` | Attempt player: question number and progress, timer (warning state under 1 minute), question text with maths and images, answer inputs by type (multiple choice, true/false, numeric, fraction, expression, short text), flag for review, report a question, navigator of answered/unanswered, submit with confirmation. Practice mode shows feedback after each answer. | Submit |
| `/student/results` | Paged history: subject, score, percentage, passed or not, date | Review |
| `/student/results/[attemptId]` | Score, proficiency band, per-question review with correct answer and explanation | Back to results |
| `/student/classroom` | Join a class by code, joined classes, class assignments | Join class |

### 6.3 Teacher

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/teacher` | Hero; metrics (classes, assignments, question banks, gradebook records); teaching overview; open assignments; recent submissions; weak indicators with affected learners; class proficiency (average, bands, completion); remedial practice setup | Create assignment |
| `/teacher/classes` | Create curriculum-linked classes; class list with join codes, enrolment, learners | Create class |
| `/teacher/assignments` | Create assignment: class, curriculum objective, available approved questions by difficulty and type, title, description, mode, selection (automatic or manual pick), difficulty, question count, attempts, preview. Existing assignments with status. | Publish assignment |
| `/teacher/question-banks` | Approved repository with filters (search, grade, subject, status, difficulty) | Use in assignment |
| `/teacher/gradebook` | Filter by class and assignment; student, score, percentage, status, proficiency, graded date; paging | View submission |
| `/teacher/submissions/[attemptId]` | Learner score and band; indicator evidence, correct or needs support, response time | Assign remedial practice |

### 6.4 Competitions (all roles)

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/competition` | Published competitions: sponsor, level, dates, status | View |
| `/competition/[id]` | Details, rules, prizes as provided, register a team (institution, team name), team list | Register team |
| `/competition/participate/[[...id]]` | Participation hub: registered competitions and what's next | Start round |
| `/competition/attempt/[id]` | Competition attempt player (same player as students, with the competition frame and stricter timer) | Submit |
| `/competition/results/[attemptId]` | Result, rank, leaderboard position | Back to competition |

### 6.5 Sponsor

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/sponsor` | Hero; metrics (active sponsorships, total committed with currency, registrations, drop-off rate); participation funnel with conversion; score distribution; reach by market and institution; question performance; linked competitions | Open workspace |
| `/sponsor/workspace` | Competition wizard: organisation picker; scope, audience, grades, markets; source upload with a rights-confirmation checkbox, extraction status and retry; generation jobs (provider, model, queue, run, retry, cancel); candidate review and publication; delivery analytics | Save draft / Queue generation / Publish |

### 6.6 SME reviewer

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/review` | Workload metrics (completed today, pending, assigned today, completed this month); paused-by-admin banner; quality and decisions (approved, revisions, rejected, QA reversal rate, average review time); earnings and compensation (earned today, paid, payable, pending QA, unresolved), with the rule "Assignment does not create earnings; completed eligible reviews do"; assigned review queue with filters; review panel: question, options, answer, explanation, curriculum alignment, validation flags, source provenance, notes, attestation checkbox, and Approve, Needs revision and Reject (Reject uses the error colour). Admins also see "Assign a review manually" collapsed. | Open next review |

### 6.7 School, tenant, seller, shared

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/school` | Institution header and school switcher; classes table (grade, teacher, students, status) with reassign teacher, archive (with confirmation) and transfer learners; membership history. Also design the "no school linked" empty state. | Reassign / Transfer |
| `/tenant/[id]` | Organisation metrics (members, classes, questions, assessments) and learning metrics (completed attempts in 30 days, average score, pass rate) | — |
| `/seller` | Products, orders, net earnings, withdrawable balance; product list and order list | Add product / Withdraw |
| `/marketplace` | Catalogue of published products with filters | View product |
| `/account` | Identity, role, markets (primary, active, authorised), school, grade or teaching profile; request a market change with reason; pending request state | Request change |
| `/notifications` | Notifications list with unread marker, mark all read, empty state | Mark all read |

### 6.8 Admin

| Route | Purpose and contents | Primary action |
|---|---|---|
| `/admin` | Hero (copy in section 3); "Needs attention" (source issues, compensation issues, markets still configuring, each with a link); metrics (users, active markets, approved questions, competitions); users by role and by market; content throughput; operations | Resolve top item |
| `/admin/markets` | Countries, markets, currencies, memberships (configuration tables with create and edit) | Add market |
| `/admin/market-setup` | Launch and govern countries; a market cannot become ACTIVE until its readiness check passes; show the checklist | Run readiness check |
| `/admin/tenants` | Tenants list with members and status | Open tenant |
| `/admin/content` | Content operations: tabs, filters, curriculum branch navigation, records with paging, question review panel, generate questions from approved sources, candidate batch import | Review question |
| `/admin/content-factory` | Campaigns table (market, status, target, generated, approved, jobs); new campaign wizard (Scope, Sources, Distribution, Generation, SME review, Review and launch); estimate before launch; distribution plan; campaign operations; bulk import; recent events | Launch campaign |
| `/admin/curriculum-sources` | Split into tabs: Import (target country, source package ZIP/JSON/CSV), Market readiness, Official publishing domains (one per authority), Source registry (review and activate per market) | Activate source |
| `/admin/quality` | Lifecycle counts, quality signals, review queue; "Flags never change approved content" | Open flagged item |
| `/admin/marketplace` | Sellers, published products, orders, seller net value | Review seller |
| `/admin/competitions` | Competitions, school registrations, teams, results, matches, open appeals, sponsors | Open competition |
| `/admin/competitions/assignments` | Assign competition questions to reviewers | Assign |
| `/admin/competitions/oversight` | Oversight tables per category (formatted tables, never raw JSON) | — |
| `/admin/reviewers` | SME profiles, domains (subject, market, grades, level, senior review) and capabilities | Add reviewer |
| `/admin/sme-performance` | Review work and earnings by currency per reviewer | Export |
| `/admin/sme-workforce` | Scheduler (preview, run); workforce table grouped into Reviewer, Domain, Limits, Today, This month, QA, Average review, Earnings, with a Manage row (pause, reassign outstanding, daily/target/max limits); workload policies; add or update policy; campaign allocation | Run scheduler |
| `/admin/compensation` | Policies and historical versions | New policy version |
| `/admin/payouts` | Earnings by status (payable, pending QA, held, paid, reversed) with bulk select; release and hold with a required note; batches (draft, approved, paid) with approve and mark paid | Create batch |
| `/admin/operations` | Account lookup, suspension, audit trail filter, failure monitoring | Look up account |
| `/admin/support` | Open tickets, SLA at risk, failed notifications, errors in 24h; ticket list | Open ticket |

## 7. States every screen must show

Design these as separate artboards for each dashboard and at least one representative of every other screen type (table, form, wizard, player, detail):

- **Loading:** skeleton blocks in the final layout, never a spinner alone.
- **Empty:** says what will appear and how to get the first one ("No assignments yet. Work from your teachers appears here.").
- **Error:** what went wrong and how to fix it, with Retry.
- **No permission:** the person is signed in but this area isn't theirs; offer their home.
- **Account states:** onboarding required, account suspended, session expired.
- **Partial data:** a metric with no real value shows "—" or "No data yet"; any illustrative figure carries `Badge tone="illustrative"`.
- **Destructive confirmation:** archive class, release outstanding reviews, hold earnings, suspend account. Build confirmations into the page (a dialog), stating the consequence.
- **Success:** a toast or inline confirmation that names what happened ("Review recorded. Publication remains separate.").

## 8. Components to add to the system

The system has 27 components covering dashboards and the homepage. To design the full app, add these, in the system's style, and document each the same way (README + preview):

Forms: Select, Textarea, Checkbox, Radio group, Switch, File upload (with progress and error), Date and date-time picker, Search field, Field group and fieldset, Inline validation message.
Navigation and structure: Tabs, Segmented control, Breadcrumbs, Pagination, Filter bar (desktop row, phone bottom sheet), Bottom sheet, Drawer, Dialog, Dropdown menu, Tooltip, Toast, Alert banner (info, warning, error, success), Skeleton, Stepper (wizard header with current step), Accordion/Disclosure.
Assessment: Question card, Answer option (default, selected, correct, incorrect, disabled), Numeric/fraction/expression inputs, Timer, Question navigator, Progress bar, Feedback panel, Flag and Report controls.
Data and workflow: Status badge set (adds error tone), Record card (mobile table row), Expandable table row, Bulk-selection bar, Timeline/event list, Diff or review panel, Key-value list, Short-reference chip (ID with copy), Avatar group, Notification item, Empty state with action, Confirmation dialog.

Add the icons each needs from the same Lucide set (24px grid, 2px stroke). The system currently ships only three.

## 9. End-to-end flows to storyboard

Show each as a numbered sequence of artboards with the transitions between them:

1. Visitor → role CTA → country-first registration → onboarding → first dashboard.
2. Student: dashboard → start assignment → attempt (each answer type) → submit confirmation → result review.
3. Teacher: create class → share join code → create assignment (automatic and manual selection) → preview → publish → gradebook → submission evidence → remedial practice.
4. SME: queue → open review → validation flags → notes and attestation → approve, request revision or reject → next item; earnings update after QA.
5. Sponsor: workspace → scope → upload source with rights confirmation → generation → candidate review → publish → participation analytics.
6. Admin content factory: new campaign wizard → estimate → launch → SME review progress → approved content.
7. Admin payouts: payable earnings → select → batch → approve → mark paid; hold with note.
8. Market launch: market setup → readiness checklist → activate.

## 10. Rules you must not break

- No invented features, prices, prize amounts, contact details, addresses or legal text.
- No fabricated metrics. Real values only; otherwise "—", "No data yet" or an illustrative badge.
- Keep the governance wording: "Registration is not approval"; "Assigned work is not payable"; "Every question enters SME review; nothing is published automatically"; "Flags never change approved content".
- Never show raw UUIDs, internal enum values (for example TOP_UP_QUEUE) or ISO timestamps. Show short references, human labels and formatted dates.
- One primary action per section. Labels are verbs in sentence case.
- Colour never carries meaning alone: pair it with a word or an icon.

## 11. Accessibility and responsiveness

- WCAG 2.1 AA: text 4.5:1 (3:1 at 24px+), control borders and focus rings 3:1, a visible 2px focus ring on every interactive element, labels tied to inputs, error text next to the field.
- Touch targets 44px on phones. No page scrolls sideways at 390px or 360px.
- Tables become labelled record cards on phones. Filters move into a bottom sheet. Long workflows show one step at a time with a sticky action bar. Metrics go 2-up.
- Reduced-motion respected; transitions ≤150ms on opacity and colour only.

## 12. Deliverables

- One design canvas. Artboards named `Role / Screen / Breakpoint / State`, for example `Teacher / Gradebook / 390 / Empty`.
- Grouped sections in this order: Foundations, Components (new ones), Public, Student, Teacher, Competitions, Sponsor, SME, School and tenant, Seller and marketplace, Shared (account, notifications), Admin, Flows.
- Each artboard annotated with: the design-system components used, the data fields shown, the primary action and what happens next.
- A change log of every token or component you added or changed, and every place you applied a section 3 decision.
- Work in this order, checking in after each: (1) foundations and new components, (2) frame and navigation, (3) the six role dashboards, (4) remaining screens by role, (5) states, (6) flows.

## 13. Done means

- Every route in section 6 exists at 1440 and 390 with its required states.
- Every artboard uses only design-system tokens and components (or documented additions).
- No raw IDs, enums or timestamps; no invented content; the governance wording is intact.
- Every role reaches every section it can access on a phone through the bottom bar or More.
- Contrast, focus, target size and label rules pass on every artboard.
