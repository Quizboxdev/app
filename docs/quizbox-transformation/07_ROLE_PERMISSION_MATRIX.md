# 07. Role and permission matrix

Date: 2026-10-25. "Today" = enforced in the current code (checked in the database function named). "Planned" = target for the release shown. Capabilities, not role labels, decide access; one person may hold several (workspace switcher). A cell is **Y** (allowed), **own** (only their own records), **agg** (aggregates only, never a person), **—** (not allowed).

## 1. Identity and capability sources

| Source | Values | Notes |
|---|---|---|
| `profiles.role` | student, teacher, admin (owner), sponsor | primary account type |
| `user_capabilities` | super_admin, content_admin, sme_reviewer, senior_sme_reviewer, competition_admin, sponsor_admin, finance_admin | granted by staff |
| `account_relationships` | guardian, sponsor, institutional links with funding / progress flags and consent | no screen yet (gap G-04) |
| `institution_memberships` | student, teacher, admin, owner of a school | school scope |
| `affiliates.status = approved` | affiliate | Release C-1 |
| `mk_sellers.status = verified` | publisher | existing |
| Planned | regional_manager (`sales_agents`), alumni_coordinator, legacy_representative (`programme_representatives`), finance_officer, national_commercial_admin | Releases E, F |

## 2. Matrix: what each role can do

| Capability | Student | Managed learner (<13) | Guardian | Teacher | School admin | Sponsor | Affiliate | Publisher | Finance | Platform admin / owner |
|---|---|---|---|---|---|---|---|---|---|---|
| Practise, assessments (own) | own | own | — | — | — | — | — | — | — | Y |
| See a learner's progress | own | own | linked child (planned UI) | own classes | own school | **—** | **—** | — | — | Y |
| Create classes, assignments | — | — | — | own | own school | — | — | — | — | Y |
| Create challenge / competition | Y (not managed) | — | Y | Y | Y | Y | Y | Y | Y | Y |
| Pay for a subscription | own (if market allows; not <13) | **—** | for linked child | own | for school (planned, B) | for beneficiaries (planned, E) | own | own | — | — |
| Apply as affiliate | adult account only, staff-verified | **—** | Y (adult) | Y | Y | Y | — | Y | Y | Y |
| See own commissions | — | — | — | — | — | — | own | — | agg and by affiliate | Y |
| See who a referred customer is | — | — | — | — | — | — | **—** (counts only) | — | **—** (payments only) | Y (support need only) |
| Approve affiliates, edit policy | — | — | — | — | — | — | — | — | Y (second approver rule) | Y (owner may self-approve, audited) |
| Reverse a commission by hand | — | — | — | — | — | — | — | — | Y with reason | Y |
| Edit a ledger row or balance | **—** for everyone, including the table owner (trigger) | | | | | | | | | |
| Sell question sets | — | — | — | verified teacher | — | — | — | Y | — | review/approve |
| Approve a marketplace item | — | — | — | not their own | — | — | — | — | — | Y |
| Payout approve / mark paid | — | — | — | — | — | — | — | — | Y | Y |
| Fund a programme, see impact report | — | — | — | — | — | agg only (planned, E) | — | — | Y | Y |
| Change results of a competition | — | — | — | — | — | **—** | — | — | — | Y with audit |
| View raw payment / reconciliation | — | — | — | — | — | — | — | — | Y | Y |

## 3. Rules that the database enforces today (with where)

- Affiliate apply refuses minors and managed learners (`qb_cm_adult_user`), requires adult attestation and terms; approval needs a staff identity confirmation and payout details; a suspended affiliate gains no customers (`qb_referral_capture`).
- Only the service role can accrue or reverse commissions (`revoke ... from authenticated`, tested).
- A finance admin cannot approve a policy they drafted; the owner can, and the audit row says so (`qb_commission_policy_approve`).
- Ledger, accrual money fields, attribution identity and approved policies cannot be edited by anyone (triggers, tested as the table owner).
- Affiliate views return no customer identity (tested: no buyer id or email appears in the summary or the finance list).
- Managed under-13 learners cannot pay or join cash programmes (`qb_challenge_active_user`, checkout route, `qb_cm_adult_user`).

## 4. Privilege-leakage checks (per workspace switch)

Every commercial function derives the actor from `auth.uid()`. A person who is both a teacher and an affiliate sees affiliate balances only on `/affiliate`, and teaching data only on teacher pages; no function takes a user id from the browser for another person's data. The workspace chip is a convenience; the database is the gate. These checks are repeated per new role as it ships (Scenario 10 in `09_QA_AND_TEST_REPORT.md`).

## 5. Gaps against the directive's role list

Not yet present in code: parent/guardian screens, regional sales manager, alumni coordinator, legacy representative, competition organiser dashboard beyond campaign ownership, national commercial administrator, finance officer as a distinct capability (today `finance_admin`), support operator scoping for commercial data. They are scheduled in `04_IMPLEMENTATION_ROADMAP.md`.
