# Route mapping: canvas 11 (new screens) and canvas 09 fixes

Design routes are semantic. Engineering may change physical URLs. Components key on ids and capabilities, never route strings. DS components are `window.QuizBox.*` (frozen DS 1791196207-241a). Boards are `<Name>` (1440) and `<Name>390` (phone).

| Route | Board component | DS components | Data needed |
|---|---|---|---|
| /pricing | Pricing (+PricingSchools, PricingSponsors wrappers by `tab`), PricingStates | PublicHeader, PublicFooter, Tabs, TextField, Disclosure, AlertBanner, StatePanel, EmptyState, Skeleton, DataTable | level (from learner/child), market, plans[]{id, name, coins, ghs}, seatBundles[], custom seat limit (1000), buy-Coins limits, payment fee, selfPurchase flag |
| /help | HelpCentre | PublicHeader, TextField, Badge, PublicFooter | topics[], popular articles[], search, contact placeholders |
| /help/[slug] | HelpArticle | Breadcrumbs, Chip, PublicHeader | article{title, topic, blocks, updatedAt, published}, related[] |
| /guides | Guides | Tabs | role, guides[] |
| /guides/[slug] | GuideArticle | Breadcrumbs, StepCard, AlertBanner | guide{title, role, steps[]{title, body}} |
| /opening | Opening | Badge, Select, TextField, Checkbox, StatePanel | phases[], interest form{role, country, email, consent} |
| /terms, /cookies, /refunds | Legal (prop `doc`) | AlertBanner, Switch, PublicHeader | document{sections[], version, effectiveDate}; cookie consent record |
| help/guides/opening/legal states | PublicStates | Skeleton, EmptyState, AlertBanner, StatePanel | none |
| /guardian/home | Guardian (screen=home) via GdHome | AppShell(guardian), MetricCard, MasteryMeter, AssignmentCard, RelationshipCard | children[]{relationship, consent}, weekly topic mastery, due assignments[] |
| /guardian/children | Guardian (children) via GdChildren | RelationshipCard, KeyValueList, AlertBanner, Disclosure | relationships[]{status, consent_status, can_fund, can_view_progress, can_manage_account}, school-managed flag |
| /guardian/progress | Guardian (progress) via GdProgress | Tabs, MetricCard, MasteryMeter | child id, topics[]{name, completion, mastery}; only if can_view_progress |
| /guardian/assignments | Guardian (assignments) via GdAssignments | DataTable, AssignmentCard | assignments[]{title, subject, due, status, result}; read only |
| /notifications (guardian) | Guardian (notifications) via GdNotifications | Tabs, NotificationItem | notifications[]{type, title, body, time, read} |
| /guardian/wallet | not redesigned | existing main 02.5 boards | n/a |
| /challenges/[slug]/round | RoundPlayer | PlayerHeader, QuestionCard, AnswerOption, PlayerActions, QuestionNavigator, SyncStatus | round{questions[], serverEndsAt}, attempt{answers[], syncState} |
| /studio/rights/[ref] | RightsTakedown | AppShell(studio), Breadcrumbs, KeyValueList, DataTable, Timeline, ConfirmDialog(requireNote), RefChip | takedown{claimant, basis, items[], status}, history[] |
| /tenant/members | TenantMembers | AppShell(tenant), DataTable, Select, TextField, ConfirmDialog | members[]{name, role, status, lastActive}, invitations[], adminCount |
| /studio/winners/[ref] | WinnerVerify | AppShell(studio), DataTable, Timeline, ConfirmDialog(requireNote) | winner{displayName, rank, score, time}, checks[], consent status, attempt events[] |
| /challenges/[slug] (enterprise) | EnterpriseView | AppShell(participant), MetricCard, ProgressBar, Leaderboard | campaign{tenant, private}, rounds[], standing[] |
| /certificates | Certificates | AppShell(participant), KeyValueList, RefChip | certificates[]{title, awardedAt, verificationCode, state}, verification URL |
| /leaderboards | Leaderboards (prop consentPending) | SegmentedControl, Leaderboard, StatePanel | scope, rows[]{rank, approvedDisplayName, points, me}, minimum finishers, consent state |
| challenges additions states | ChStates | Skeleton, EmptyState, AlertBanner, StatePanel | none |
| /affiliate | Affiliate (prop programmeOff) | AppShell, TextField, Tabs, MetricCard, DataTable, StatePanel | affiliate{link, code}, earnings[]{date, level or role, event, status pending/available/paid, amountGHS}, payout{method, minimum}, programme on/off |
| /admin/affiliates | AdminAffiliates (prop viewer owner/admin) | AppShell(admin), Switch, DataTable, ConfirmDialog(requireNote), RefChip | programme{on}, payoutRequests[], affiliates[]{ref, referrals, pending, available, paid, status}; owner flag |
| affiliate states | AffStates | state components | none |
| Studio question review (fix) | canvas 09 StQuestions | ConfirmDialog(requireNote) | question ref, reject reason |
| Admin campaign review (fix) | canvas 09 AdCampaigns | ConfirmDialog(requireNote) | campaign ref, reject reason |
| Studio new campaign (fix) | canvas 09 StCreate + StCreate390 | Stepper (4 phases) | phase to step map: Setup 1-2, Content 3-4, Competition 5-8, Launch 9-13 |

## Assumptions (not decisions)
- Same prices across levels; sponsor seat bundles mirror school bundles (1 participant = 1 Coin).
- Guardian Fund not redesigned; guardian shell uses locked nav.
- Affiliate frame is a placeholder (Student frame) pending who can be an affiliate; "Affiliates" admin nav item is proposed.
- All amounts, dates, rates, minimums, legal text and contacts are bracketed placeholders. Nothing in OPEN_DECISIONS.md was decided.
