-- Data exports for the admin tools: one checked function builds any dataset for a date range and category, and the server turns it into CSV or Excel.
--   qb_export_catalog()   the datasets the signed-in person may export (each dataset has its own permission group), with their category choices
--   qb_export_run(dataset, from, to, category, limit)   rows for one dataset: only for staff who may see that data; a real export (more than 100 rows) is written to the audit log
-- Privacy by design: money and people datasets are limited to finance and owner roles; children's accounts (teacher-managed, under 13) are left out of the people datasets; payout account numbers are never exported;
-- learner results are exported without names (an anonymous learner code).
-- Additive and read-only: nothing here changes any existing data. Rollback: supabase/rollback/admin_exports.sql.
begin;

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

create or replace function public.qb_export_catalog() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', d.key, 'label', d.label, 'group', d.grp, 'date_label', d.date_label, 'category_label', d.category_label, 'categories', to_jsonb(d.categories), 'description', d.descr))
    from public.qb_export_defs() d where public.qb_export_can(d.need) and to_regclass(d.tbl) is not null), '[]'::jsonb);
end $fn$;

-- Builds one dataset. Internal: callers go through qb_export_run, which checks who is asking. Returns {columns, rows, total, truncated}; each row is a list in the column order.
-- The datasets are built by five small functions (a to e), each answering only its own datasets and returning null for any other, so this one dispatches.

create or replace function public.qb_export_build_a(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'payments' then
    v_cols := array['Reference', 'Created (UTC)', 'Settled (UTC)', 'Status', 'Purpose', 'Plan or item', 'Source', 'Provider', 'Method', 'Currency', 'Amount', 'Coins', 'Reconciliation', 'Buyer email', 'Buyer role', 'Paid by email'];
    with f as (select i.created_at as k, jsonb_build_array(i.reference, public.qb_export_ts(i.created_at), public.qb_export_ts(i.settled_at), i.status, coalesce(i.metadata ->> 'purpose', 'coins'), coalesce(i.metadata ->> 'plan', i.metadata ->> 'item_title'),
        nullif(concat_ws(' · ', i.metadata ->> 'item_subject', i.metadata ->> 'item_school'), ''), i.provider, i.method, i.currency_code, round(i.amount_minor / 100.0, 2), i.coins, i.reconciliation_status, b.email, lower(b.role::text), pa.email) as r
      from public.payment_intents i left join public.profiles b on b.id = i.beneficiary_user_id left join public.profiles pa on pa.id = i.payer_user_id
      where (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to) and (p_category is null or i.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'subscriptions' then
    v_cols := array['Created (UTC)', 'Learner email', 'Plan', 'Status', 'Source', 'Payment reference', 'Valid from (UTC)', 'Valid until (UTC)', 'Revoked (UTC)', 'Note'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), u.email, s.plan, s.status, s.source, s.source_ref, public.qb_export_ts(s.valid_from), public.qb_export_ts(s.valid_until), public.qb_export_ts(s.revoked_at), left(s.note, 300)) as r
      from public.learner_subscriptions s left join public.profiles u on u.id = s.user_id
      where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'coin_ledger' then
    v_cols := array['Created (UTC)', 'Account email', 'Type', 'Bucket', 'Coins', 'Balance after', 'Reason'];
    with f as (select t.created_at as k, jsonb_build_array(public.qb_export_ts(t.created_at), u.email, t.kind, t.bucket, t.amount, t.balance_after, left(t.reason, 200)) as r
      from public.coin_transactions t left join public.wallets w on w.id = t.wallet_id left join public.profiles u on u.id = w.user_id
      where (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to) and (p_category is null or t.kind = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'refund_cases' then
    v_cols := array['Requested (UTC)', 'Payment reference', 'Account email', 'Kind', 'Status', 'Coins credited', 'Decided (UTC)', 'Decision note'];
    with f as (select c.requested_at as k, jsonb_build_array(public.qb_export_ts(c.requested_at), c.payment_reference, u.email, c.kind, c.status, c.coins_credited, public.qb_export_ts(c.decided_at), left(c.decision_note, 300)) as r
      from public.refund_cases c left join public.profiles u on u.id = c.beneficiary_user_id
      where (p_from is null or c.requested_at >= p_from) and (p_to is null or c.requested_at < p_to) and (p_category is null or c.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'price_list' then
    v_cols := array['Code', 'Name', 'For', 'Kind', 'Period', 'Price', 'Currency', 'Active', 'Updated (UTC)'];
    with f as (select p.updated_at as k, jsonb_build_array(p.code, p.name, p.audience, p.kind, p.period, round(p.price_minor / 100.0, 2), p.currency, p.active, public.qb_export_ts(p.updated_at)) as r
      from public.price_list p
      where (p_from is null or p.updated_at >= p_from) and (p_to is null or p.updated_at < p_to) and (p_category is null or p.audience = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_b(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'mk_sales' then
    v_cols := array['Purchased (UTC)', 'Payment reference', 'Question set', 'Subject', 'School', 'Class', 'Price', 'Teacher share', 'QuizBox share', 'Status', 'Access until (UTC)', 'Reversed (UTC)', 'Reversal reason', 'Teacher', 'Buyer email'];
    with f as (select p.purchased_at as k, jsonb_build_array(public.qb_export_ts(p.purchased_at), p.payment_reference, p.item_title, p.item_subject, p.item_school, p.item_grade, round(p.price_minor / 100.0, 2), round(p.seller_share_minor / 100.0, 2),
        round(p.platform_fee_minor / 100.0, 2), p.status, public.qb_export_ts(p.expires_at), public.qb_export_ts(p.reversed_at), left(p.reversal_reason, 200), s.display_name, b.email) as r
      from public.mk_purchases p left join public.mk_sellers s on s.id = p.seller_id left join public.profiles b on b.id = p.buyer_user_id
      where (p_from is null or p.purchased_at >= p_from) and (p_to is null or p.purchased_at < p_to) and (p_category is null or p.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'mk_payouts' then
    v_cols := array['Requested (UTC)', 'Due (UTC)', 'Paid (UTC)', 'Teacher', 'School', 'Amount', 'Sales', 'Sales total', 'QuizBox share', 'Refunds', 'Status', 'Overdue', 'Transfer reference', 'Note'];
    with f as (select p.requested_at as k, jsonb_build_array(public.qb_export_ts(p.requested_at), public.qb_export_ts(p.due_at), public.qb_export_ts(p.paid_at), s.display_name, s.school_name, round(p.amount_minor / 100.0, 2), p.sales_count, round(p.gross_minor / 100.0, 2),
        round(p.platform_fee_minor / 100.0, 2), round(p.refunds_minor / 100.0, 2), p.status, (p.status = 'requested' and p.due_at < now()), p.transfer_ref, left(p.decided_note, 300)) as r
      from public.mk_payouts p left join public.mk_sellers s on s.id = p.seller_id
      where (p_from is null or p.requested_at >= p_from) and (p_to is null or p.requested_at < p_to) and (p_category is null or p.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'mk_ledger' then
    v_cols := array['Created (UTC)', 'Available from (UTC)', 'Teacher', 'Type', 'Amount', 'Note'];
    with f as (select l.created_at as k, jsonb_build_array(public.qb_export_ts(l.created_at), public.qb_export_ts(l.available_at), s.display_name, l.kind, round(l.amount_minor / 100.0, 2), left(l.note, 200)) as r
      from public.mk_ledger l left join public.mk_sellers s on s.id = l.seller_id
      where (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to) and (p_category is null or l.kind = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'mk_items' then
    v_cols := array['Created (UTC)', 'Title', 'Subject', 'School', 'Class', 'Term', 'Price', 'Status', 'Questions', 'Sold', 'Teacher', 'Approved (UTC)', 'Review note'];
    with f as (select i.created_at as k, jsonb_build_array(public.qb_export_ts(i.created_at), i.title, i.subject, i.school_name, i.grade, i.term, round(i.price_minor / 100.0, 2), i.status, i.question_count, i.purchases_count, s.display_name, public.qb_export_ts(i.approved_at), left(i.review_note, 300)) as r
      from public.mk_items i left join public.mk_sellers s on s.id = i.seller_id
      where (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to) and (p_category is null or i.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'mk_sellers' then
    v_cols := array['Applied (UTC)', 'Name', 'School', 'Email', 'Status', 'Payout method', 'Payout network', 'Verified (UTC)', 'Sets', 'Note'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), s.display_name, s.school_name, u.email, s.status, s.payout_method, s.payout_network, public.qb_export_ts(s.verified_at),
        (select count(*) from public.mk_items i where i.seller_id = s.id), left(s.review_note, 300)) as r
      from public.mk_sellers s left join public.profiles u on u.id = s.user_id
      where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_c(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'sme_earnings' then
    v_cols := array['Earned (UTC)', 'Reviewer email', 'Type', 'Quantity', 'Base amount', 'Multiplier', 'Bonus', 'Deduction', 'Final amount', 'Currency', 'Status', 'Payable (UTC)', 'Payout batch'];
    with f as (select e.earned_at as k, jsonb_build_array(public.qb_export_ts(e.earned_at), u.email, e.earning_type, e.quantity, e.base_amount, e.multiplier, e.bonus_amount, e.deduction_amount, e.final_amount, e.currency_code,
        coalesce((select st.status from public.reviewer_earning_states st where st.earning_id = e.id order by st.id desc limit 1), e.status), public.qb_export_ts(e.payable_at), e.payout_batch_id) as r,
        coalesce((select st.status from public.reviewer_earning_states st where st.earning_id = e.id order by st.id desc limit 1), e.status) as cat
      from public.reviewer_earnings e left join public.profiles u on u.id = e.reviewer_id
      where (p_from is null or e.earned_at >= p_from) and (p_to is null or e.earned_at < p_to))
    select (select count(*) from f where p_category is null or f.cat = p_category), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f where p_category is null or f.cat = p_category order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'sme_payout_batches' then
    v_cols := array['Created (UTC)', 'Period start (UTC)', 'Period end (UTC)', 'Status', 'Currency', 'Items', 'Total amount', 'Paid (UTC)'];
    with f as (select b.created_at as k, jsonb_build_array(public.qb_export_ts(b.created_at), public.qb_export_ts(b.period_start), public.qb_export_ts(b.period_end), b.status, b.currency_code,
        (select count(*) from public.sme_payout_items i where i.payout_batch_id = b.id), (select coalesce(sum(i.amount), 0) from public.sme_payout_items i where i.payout_batch_id = b.id), public.qb_export_ts(b.paid_at)) as r
      from public.sme_payout_batches b
      where (p_from is null or b.created_at >= p_from) and (p_to is null or b.created_at < p_to) and (p_category is null or b.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'sme_reviews' then
    v_cols := array['Completed (UTC)', 'Reviewer email', 'Decision', 'Seconds taken', 'Revisions', 'Final status', 'QA reversal', 'Dispute', 'Question'];
    with f as (select e.review_completed_at as k, jsonb_build_array(public.qb_export_ts(e.review_completed_at), u.email, e.decision, e.review_duration_seconds, e.revision_count, e.final_status, e.qa_reversal, e.dispute, e.question_id) as r
      from public.sme_review_events e left join public.profiles u on u.id = e.reviewer_id
      where (p_from is null or e.review_completed_at >= p_from) and (p_to is null or e.review_completed_at < p_to) and (p_category is null or e.decision = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'support_requests' then
    v_cols := array['Reference', 'Created (UTC)', 'Topic', 'Subject', 'Status', 'Priority', 'Source', 'Requester email', 'Resolved (UTC)', 'Hours to resolve'];
    with f as (select r0.created_at as k, jsonb_build_array(r0.reference, public.qb_export_ts(r0.created_at), r0.category, left(r0.subject, 150), r0.status, r0.priority, r0.source, r0.requester_email, public.qb_export_ts(r0.resolved_at),
        round(extract(epoch from (r0.resolved_at - r0.created_at)) / 3600.0, 1)) as r
      from public.support_requests r0
      where (p_from is null or r0.created_at >= p_from) and (p_to is null or r0.created_at < p_to) and (p_category is null or r0.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'help_articles' then
    v_cols := array['Slug', 'Title', 'Topic', 'For', 'State', 'Views', 'Helpful yes', 'Helpful no', 'Updated (UTC)', 'Published (UTC)'];
    with f as (select h.updated_at as k, jsonb_build_array(h.slug, h.title, h.category, array_to_string(h.audiences, ', '), h.state, h.views, h.helpful_yes, h.helpful_no, public.qb_export_ts(h.updated_at), public.qb_export_ts(h.published_at)) as r
      from public.help_articles h
      where (p_from is null or h.updated_at >= p_from) and (p_to is null or h.updated_at < p_to) and (p_category is null or h.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_d(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'challenges' then
    v_cols := array['Created (UTC)', 'Title', 'Type', 'Format', 'Status', 'Visibility', 'Questions', 'Starts (UTC)', 'Ends (UTC)', 'Players', 'Attempts', 'Owner email'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.title, c.category, c.format, c.status, c.visibility, c.question_count, public.qb_export_ts(c.starts_at), public.qb_export_ts(c.ends_at),
        (select count(*) from public.challenge_participants p where p.campaign_id = c.id), (select count(*) from public.challenge_attempts a where a.campaign_id = c.id), u.email) as r
      from public.challenge_campaigns c left join public.profiles u on u.id = c.owner_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'challenge_attempts' then
    v_cols := array['Started (UTC)', 'Challenge', 'Type', 'Learner code', 'Attempt', 'Score', 'Out of', 'Percent', 'Seconds taken', 'Submitted', 'Timed out'];
    with f as (select a.started_at as k, jsonb_build_array(public.qb_export_ts(a.started_at), c.title, c.category, left(md5(a.user_id::text), 10), a.attempt_no, a.score, a.max_score,
        case when coalesce(a.max_score, 0) > 0 then round(100.0 * a.score / a.max_score, 1) end, round(a.duration_ms / 1000.0, 1), a.submitted_at is not null, a.expired) as r
      from public.challenge_attempts a join public.challenge_campaigns c on c.id = a.campaign_id
      where (p_from is null or a.started_at >= p_from) and (p_to is null or a.started_at < p_to) and (p_category is null or c.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'question_bank' then
    v_cols := array['Subject', 'Grade', 'Status', 'Questions'];
    with f as (select count(*) as k, jsonb_build_array(q.subject_name, q.grade::text, q.status::text, count(*)) as r
      from public.questions q
      where (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to) and (p_category is null or q.subject_name = p_category)
      group by q.subject_name, q.grade::text, q.status::text)
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'question_batches' then
    v_cols := array['Created (UTC)', 'File', 'Scope', 'Status', 'Rows in file', 'Rows loaded', 'Rows rejected', 'Completed (UTC)', 'Uploaded by'];
    with f as (select b.created_at as k, jsonb_build_array(public.qb_export_ts(b.created_at), b.file_name, b.scope, b.status, b.rows_total, b.rows_loaded, b.rows_rejected, public.qb_export_ts(b.completed_at), u.email) as r
      from public.question_load_batches b left join public.profiles u on u.id = b.uploaded_by
      where (p_from is null or b.created_at >= p_from) and (p_to is null or b.created_at < p_to) and (p_category is null or b.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_e(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'users' then
    v_cols := array['Created (UTC)', 'Role', 'Status', 'Name', 'Email', 'Country', 'Region', 'School'];
    with f as (select u.created_at as k, jsonb_build_array(public.qb_export_ts(u.created_at), lower(u.role::text), lower(u.status::text), u.full_name, u.email, u.country, u.region, u.school_name) as r
      from public.profiles u
      where not exists (select 1 from public.student_profiles sp where sp.user_id = u.id and sp.is_minor)
        and (p_from is null or u.created_at >= p_from) and (p_to is null or u.created_at < p_to) and (p_category is null or lower(u.role::text) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'policy_acceptances' then
    v_cols := array['Accepted (UTC)', 'Policy', 'Version', 'Account email', 'Role'];
    with f as (select pa.accepted_at as k, jsonb_build_array(public.qb_export_ts(pa.accepted_at), d.title, v.version_no, u.email, lower(u.role::text)) as r
      from public.policy_acceptances pa join public.policy_versions v on v.id = pa.version_id join public.policy_documents d on d.id = v.document_id left join public.profiles u on u.id = pa.user_id
      where not exists (select 1 from public.student_profiles sp where sp.user_id = pa.user_id and sp.is_minor)
        and (p_from is null or pa.accepted_at >= p_from) and (p_to is null or pa.accepted_at < p_to) and (p_category is null or d.slug = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'audit_log' then
    v_cols := array['Time (UTC)', 'Actor email', 'Actor role', 'Action', 'Area', 'Record type', 'Record id', 'Outcome', 'Details'];
    with f as (select a.created_at as k, jsonb_build_array(public.qb_export_ts(a.created_at), u.email, lower(a.actor_role::text), a.action, split_part(a.action, '.', 1), a.entity_type, a.entity_id, a.status, left(a.details::text, 500)) as r
      from public.audit_logs a left join public.profiles u on u.id = a.actor_user_id
      where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to) and (p_category is null or split_part(a.action, '.', 1) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb;
begin
  r := coalesce(public.qb_export_build_a(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_b(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_c(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_d(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_e(p_dataset, p_from, p_to, p_category, p_limit));
  if r is null then raise exception 'QB_UNKNOWN_DATASET' using errcode = '22023'; end if;
  return r;
end $fn$;

-- The checked entry point. A preview (up to 100 rows) is not logged; a real export is.
create or replace function public.qb_export_run(p_dataset text, p_from timestamptz default null, p_to timestamptz default null, p_category text default null, p_limit integer default 50000) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare d record; v_limit integer := least(greatest(coalesce(p_limit, 50000), 0), 100000); v_cat text := nullif(btrim(coalesce(p_category, '')), ''); r jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into d from public.qb_export_defs() x where x.key = p_dataset;
  if d.key is null or not public.qb_export_can(d.need) or to_regclass(d.tbl) is null then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'QB_INVALID_RANGE' using errcode = '22023'; end if;
  if v_cat is not null and d.categories is not null and not (v_cat = any (d.categories)) then raise exception 'QB_INVALID_CATEGORY' using errcode = '22023'; end if;
  r := public.qb_export_build(d.key, p_from, p_to, v_cat, v_limit);
  if v_limit > 100 then
    perform quizbox_core.audit('export.run', 'export', null, jsonb_build_object('dataset', d.key, 'from', p_from, 'to', p_to, 'category', v_cat, 'rows', jsonb_array_length(r -> 'rows'), 'total', r -> 'total'));
  end if;
  return r || jsonb_build_object('dataset', d.key, 'label', d.label);
end $fn$;

revoke all on function public.qb_export_ts(timestamptz), public.qb_export_is_admin(), public.qb_export_can(text), public.qb_export_defs(), public.qb_export_build(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_a(text, timestamptz, timestamptz, text, integer), public.qb_export_build_b(text, timestamptz, timestamptz, text, integer), public.qb_export_build_c(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_d(text, timestamptz, timestamptz, text, integer), public.qb_export_build_e(text, timestamptz, timestamptz, text, integer),
  public.qb_export_catalog(), public.qb_export_run(text, timestamptz, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.qb_export_catalog(), public.qb_export_run(text, timestamptz, timestamptz, text, integer) to authenticated;

commit;
notify pgrst, 'reload schema';
