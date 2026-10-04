# UI Reference Kit Mapping

Visual source: `../QuizBox_UI_Reference_Kit.zip`. The HTML is a presentation reference, not application code. No kit JavaScript or illustrative records are shipped.

| Reference | Existing route | Preserved data and controls |
| --- | --- | --- |
| Student | `/student` | Student dashboard, competition analytics, achievements, attempt start, results |
| Teacher | `/teacher` | Teacher dashboard/analytics, indicator drill-down, learner selection, remedial publication |
| Sponsor | `/sponsor` | Sponsor profile, sponsorships, participation funnel, scores, demographics, question performance |
| SME | `/review` | Workload, review workbench, policy, quality, earnings, candidate reviews |
| School | `/school` | Authorized institutions, teachers, classes, enrollment, reassignment, transfers, history |
| Admin | `/admin` | Platform overview, content health, competition metrics, operations health |

Shared implementation: `AppShell`, `StatCard`, `DashboardHero`, existing Recharts components and `app/globals.css`. The reference's 224px sidebar, 64px top bar, 16px gaps, light surfaces, blue accents and dark welcome bands are adapted to existing UI classes. Existing real branding is retained; no prototype logo replaces it.

Prototype actions resolve to existing routes or anchored sections. There are no placeholder `data-route` actions. Existing role-route guards, market context, authentication and API handlers are unchanged.

## Unavailable Prototype Data

- Student streak: no existing dashboard streak field; pending assignments are shown instead.
- School participation/performance: no existing School overview contract; real class enrollment and active-class metrics are shown instead. Enrollment is not labelled as a distinct-student count.
- Sponsor reports and dedicated SME quality-history routes: no corresponding standalone routes. Existing dashboard quality, analytics and earnings surfaces are retained rather than adding fake navigation.

No backend changes are implied by these gaps. Authenticated desktop/mobile screenshot approval requires a signed-in local browser session. Unit tests and a build alone do not certify visual fidelity.
