# Staff access (connected workflows)

Migration `20261070100000_staff_access.sql`. It ships **off**: the **Staff access** link stays hidden and the database refuses every change until the flag below is set to `true`. Apply to **Preview first**, check, then Production.

## What it does
- A **Super Admin** opens **Admin, Staff access**, finds a colleague by the email on their QuizBox account, ticks the workflows they may use, and saves. They can change or withdraw it at any time.
- Three workflows, each a bundle of admin tabs that belong together. Each stands for a staff capability the database **already enforces on every action**, so a tick can never give more than that capability allows:

| Workflow | Capability | Tabs it opens |
|---|---|---|
| Content team | `content_admin` | Content Factory, Load Questions, Topics for Teachers, SME Workforce, SME Reviews, Reviewer Policy, Export data |
| Support desk | `sme_support` | Enquiry Inbox, Support requests, Help guides, Reviewer Applications, Export data |
| Finance (marked sensitive) | `finance_admin` | SME Performance, Payouts, Payment checks, Affiliates, Export data |

- The colleague sees those tabs under **Administration** in their menu the next time they open the app. Their own learner, teacher or sponsor pages are unchanged.
- **Not part of any workflow:** Markets, Curriculum Sources, Approve Batches, Compensation, Policies, Access & Subscriptions, Young learners, and anything about Git, Vercel or Supabase. Those stay Super Admin only.
- A Super Admin or owner account cannot be changed here. Other capabilities a person holds (reviewer, and so on) are never touched.
- Every change is written to the audit log (`staff_access_set`: who, which email, workflows before and after).
- The menu now waits until a person's staff access has been read before it decides whether a page is allowed. This also stops a reviewer or finance user being sent home by mistake on a slow connection.

## Apply (Preview, then Production)
1. Supabase SQL editor, paste `docs/release/sql-parts/20261070100000/p1.sql`. Safe to run again.
2. Turn the flag on when ready (the owner runs this; Preview first):
```sql
update public.platform_settings set value = 'true'::jsonb where key = 'flags.staff_access' and scope_type = 'global';
```
3. Check on Preview as the Preview admin (a Super Admin): **Admin, Staff access**. Find the Preview teacher by email, tick **Support desk**, save. Sign in as that teacher: **Administration** now lists Enquiry Inbox, Support requests, Help guides and Reviewer Applications. Untick it as the admin and the tabs go. Check the record:
```sql
select created_at, details from public.audit_logs where action = 'staff_access_set' order by created_at desc limit 5;
```

## Turn it off or undo
- Off: set the same setting to `'false'`. People keep the capabilities already granted (they are ordinary capabilities); only the screen and the menu entries go.
- To withdraw one person while it is off: set that capability inactive in `public.user_capabilities`.
- Undo: `supabase/rollback/staff_access.sql` (drops the functions and schema and removes the flag row; access already given stays).

## Not in this change
- Each page is not yet individually guarded by workflow. The tabs are hidden from the menu and the database enforces the real limits on every action; a page-level guard is a later step.
- Accounts whose role is already **Admin** keep the full admin menu they have today. Staff access is for colleagues whose account is another role.
