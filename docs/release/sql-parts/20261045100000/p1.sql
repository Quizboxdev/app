-- Data exports for the admin tools: one checked function builds any dataset for a date range and category, and the server turns it into CSV or Excel.
--   qb_export_catalog()   the datasets the signed-in person may export (each dataset has its own permission group), with their category choices
--   qb_export_run(dataset, from, to, category, limit)   rows for one dataset: only for staff who may see that data; a real export (more than 100 rows) is written to the audit log
-- Privacy by design: money and people datasets are limited to finance and owner roles; children's accounts (teacher-managed, under 13) are left out of the people datasets; payout account numbers are never exported;
-- learner results are exported without names (an anonymous learner code).
-- Additive and read-only: nothing here changes any existing data. Rollback: supabase/rollback/admin_exports.sql.


create or replace function public.qb_export_ts(p timestamptz) returns text language sql immutable set search_path = '' as $fn$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'); $fn$;

create or replace function public.qb_export_is_admin() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active' and upper(p.role::text) in ('ADMIN', 'OWNER'));
$fn$;

-- Who may export which group: finance = money, owner = people and audit, support / content / competitions = their own areas. Owners pass every group.
create or replace function public.qb_export_can(p_need text) returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and case p_need
    when 'finance' then quizbox_core.is_staff(array['super_admin', 'finance_admin'])
    when 'owner' then quizbox_core.is_staff(array['super_admin'])
    when 'support' then quizbox_core.is_staff(array['super_admin', 'support_agent']) or public.qb_export_is_admin()
    when 'content' then quizbox_core.is_staff(array['super_admin', 'content_admin']) or public.qb_export_is_admin()
    when 'competitions' then quizbox_core.is_staff(array['super_admin', 'competition_admin', 'competition_manager']) or public.qb_export_is_admin()
    when 'admin' then quizbox_core.is_staff(array['super_admin']) or public.qb_export_is_admin()
    else false end;
$fn$;

-- The list of datasets. "tbl" is the main table: a dataset is offered only when that table exists in this database.
create or replace function public.qb_export_defs() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
language sql immutable set search_path = '' as $fn$
  select * from (values
    ('payments'::text, 'Payments'::text, 'Money'::text, 'Created'::text, 'Status'::text, array['initiated', 'pending', 'successful', 'failed', 'cancelled', 'expired', 'reversed', 'refunded']::text[], 'finance'::text, 'public.payment_intents'::text, 'Every Paystack payment: amount, Coins, what was bought, buyer, settlement.'::text),
    ('subscriptions', 'Subscriptions', 'Money', 'Created', 'Status', array['active', 'revoked']::text[], 'finance', 'public.learner_subscriptions', 'Learner subscriptions: plan, dates, how it was granted.'),
    ('coin_ledger', 'Coin ledger', 'Money', 'Created', 'Type', array['purchase_credit', 'promo_grant', 'spend', 'refund', 'reversal', 'manual_adjustment', 'expiry']::text[], 'finance', 'public.coin_transactions', 'Every Coin credit and spend with the balance after it.'),
    ('refund_cases', 'Refund cases', 'Money', 'Requested', 'Status', array['open', 'credited', 'cash_refund_due', 'cash_refunded', 'declined']::text[], 'finance', 'public.refund_cases', 'Refund and duplicate-payment cases and how they ended.'),
    ('price_list', 'Price list', 'Money', 'Updated', 'For', array['learner', 'teacher', 'school', 'host', 'sponsor', 'company', 'other']::text[], 'admin', 'public.price_list', 'The prices on the pricing page.'),
    ('mk_sales', 'Marketplace sales', 'Marketplace', 'Purchased', 'Status', array['active', 'reversed']::text[], 'finance', 'public.mk_purchases', 'One row per sale with the 60/40 split, the source (subject and school) and the buyer.'),
    ('mk_payouts', 'Marketplace payouts', 'Marketplace', 'Requested', 'Status', array['requested', 'paid', 'rejected', 'cancelled']::text[], 'finance', 'public.mk_payouts', 'Teacher payout requests, due times and transfer references (no account numbers).'),
    ('mk_ledger', 'Marketplace teacher ledger', 'Marketplace', 'Created', 'Type', array['sale', 'reversal', 'adjustment', 'payout_reserved', 'payout_released']::text[], 'finance', 'public.mk_ledger', 'Every movement on a teacher''s balance.'),
    ('mk_items', 'Marketplace question sets', 'Marketplace', 'Created', 'Status', array['draft', 'submitted', 'approved', 'rejected', 'unlisted']::text[], 'content', 'public.mk_items', 'Every question set with its source, price, status and sales count.'),
    ('mk_sellers', 'Marketplace sellers', 'Marketplace', 'Applied', 'Status', array['pending', 'verified', 'suspended']::text[], 'content', 'public.mk_sellers', 'Teachers who applied to sell (no account numbers).'),
    ('sme_earnings', 'Reviewer earnings', 'Reviewers', 'Earned', 'Status', array['pending_qa', 'payable', 'held', 'paid', 'reversed']::text[], 'finance', 'public.reviewer_earnings', 'What each reviewer earned for each review.'),
    ('sme_payout_batches', 'Reviewer payout batches', 'Reviewers', 'Created', 'Status', array['draft', 'approved', 'paid']::text[], 'finance', 'public.sme_payout_batches', 'Reviewer payout batches with totals.'),
    ('sme_reviews', 'Reviewer decisions', 'Reviewers', 'Completed', 'Decision', array['approve', 'reject', 'revision']::text[], 'content', 'public.sme_review_events', 'Every question review: decision, time taken, revisions.'),
    ('support_requests', 'Support requests', 'Support and help', 'Created', 'Topic', array['account', 'payment', 'class', 'challenge', 'content', 'other']::text[], 'support', 'public.support_requests', 'Support requests with status, priority and time to resolve.'),
    ('help_articles', 'Help guides', 'Support and help', 'Updated', 'Topic', array['getting-started', 'practise', 'classes', 'assignments', 'challenges', 'payments', 'account', 'safety']::text[], 'support', 'public.help_articles', 'Every guide with its views and helpful votes.'),
    ('challenges', 'Challenges and competitions', 'Challenges', 'Created', 'Type', array['school', 'book', 'general_knowledge', 'curriculum', 'sponsor', 'community']::text[], 'competitions', 'public.challenge_campaigns', 'Every quiz with its owner, status, players and attempts.'),
    ('challenge_attempts', 'Challenge results', 'Challenges', 'Started', 'Type', array['school', 'book', 'general_knowledge', 'curriculum', 'sponsor', 'community']::text[], 'competitions', 'public.challenge_attempts', 'Every attempt with score and time. Learners appear as an anonymous code, never by name.'),
    ('question_bank', 'Question bank summary', 'Content', 'Added', 'Subject', null::text[], 'content', 'public.questions', 'How many questions there are by subject, grade and status.'),
    ('question_batches', 'Question loading batches', 'Content', 'Created', 'Status', array['CHECKED', 'LOADING', 'LOADED', 'PARTIAL', 'FAILED', 'REJECTED']::text[], 'content', 'public.question_load_batches', 'Every question file loaded, with rows loaded and rejected.'),
    ('users', 'Accounts', 'People and audit', 'Created', 'Role', array['student', 'teacher', 'admin', 'sponsor', 'owner']::text[], 'owner', 'public.profiles', 'Accounts by role, status and school. Teacher-managed children are left out.'),
    ('policy_acceptances', 'Policy acceptances', 'People and audit', 'Accepted', 'Policy', array['terms', 'privacy', 'refunds', 'cookies']::text[], 'owner', 'public.policy_acceptances', 'Who accepted which version of which policy, and when.'),
    ('audit_log', 'Audit log', 'People and audit', 'Created', 'Area', null::text[], 'owner', 'public.audit_logs', 'Who did what: every recorded admin and money action.')
  ) as v(key, label, grp, date_label, category_label, categories, need, tbl, descr);
$fn$;
