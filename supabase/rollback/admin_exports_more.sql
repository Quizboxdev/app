-- Rollback for 20261046100000_admin_exports_more.sql: puts back the list of 22 datasets and the original dispatcher, and removes the new functions.
begin;
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
create or replace function public.qb_export_build(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb;
begin
  r := coalesce(public.qb_export_build_a(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_b(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_c(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_d(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_e(p_dataset, p_from, p_to, p_category, p_limit));
  if r is null then raise exception 'QB_UNKNOWN_DATASET' using errcode = '22023'; end if;
  return r;
end $fn$;
drop function if exists public.qb_export_build_f(text, timestamptz, timestamptz, text, integer), public.qb_export_build_g(text, timestamptz, timestamptz, text, integer), public.qb_export_build_h(text, timestamptz, timestamptz, text, integer);
drop function if exists public.qb_export_defs_a(), public.qb_export_defs_b();
commit;
notify pgrst, 'reload schema';
