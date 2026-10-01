# QuizBox v1.0 Pilot Acceptance Checklist

Backend: `QB-BACKEND-FINAL-1`  
Frontend: Batch 1 + Batch 2  
Payments: Deferred

Use dedicated pilot accounts for each role. Record the account, tenant, date,
result, and evidence for every completed journey.

## Student

- [ ] Sign in and land on `/student`.
- [ ] Load dashboard, classroom, assessments, and results history.
- [ ] Start an assessment through `qb_start_attempt`.
- [ ] Confirm `qb_get_attempt` returns questions without answer snapshots.
- [ ] Save one response through `qb_save_response`.
- [ ] Refresh and resume the same attempt with the saved response intact.
- [ ] Submit through `qb_submit_attempt` and load `qb_get_result`.
- [ ] Confirm correct answers appear only through post-submission review.

## Teacher

- [ ] Sign in and land on `/teacher`.
- [ ] Load classes, assignments, question banks, and gradebook.
- [ ] Confirm access to owned resources.
- [ ] Confirm another tenant's private resources are denied.

## Admin / Owner

- [ ] Sign in and land on `/admin`.
- [ ] Load platform overview, content health, marketplace metrics, competition
      metrics, support operations, tenants, and feature flags.
- [ ] Open a tenant dashboard.

## Seller

- [ ] Sign in with an account linked to `marketplace_sellers`.
- [ ] Confirm the Seller navigation item appears and `/seller` loads.
- [ ] Load products, earnings, and payout records.
- [ ] Confirm no payment-gateway action is available.

## Sponsor

- [ ] Sign in and land on `/sponsor`.
- [ ] Load the sponsor profile and competition sponsorships.
- [ ] Confirm committed amounts display correctly.

## Competition

- [ ] Load the competition catalogue and open a competition.
- [ ] Register a school where authorized.
- [ ] Create a team and manage its roster where authorized.
- [ ] Load the leaderboard and verify finalized results are readable.

## Security

- [ ] Confirm a student cannot read admin data.
- [ ] Confirm a student cannot read answer-bearing assessment tables directly.
- [ ] Confirm active attempts omit `correct_answer_snapshot` and
      `answer_spec_snapshot`.
- [ ] Confirm cross-tenant teacher access is denied.
- [ ] Confirm ordinary users only see published, approved marketplace products.
- [ ] Confirm browser bundles contain no secret or service-role key.
- [ ] Confirm the operations endpoint returns `401` without `QB_OPS_SECRET`.
