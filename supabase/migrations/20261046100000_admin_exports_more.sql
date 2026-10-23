-- Ten more export datasets: interschool competitions and their results, sponsors, classes, class results, assignments, notifications, teachers and learners.
-- Added to the export system of migration 20261045100000 (which must be applied first). Read-only and additive; the same privacy rules apply:
-- children's accounts (teacher-managed, under 13) are left out of the learner list, results show learners as an anonymous code, class join codes are never exported, and notification text is not exported (only its type and whether it was read).
-- Rollback: supabase/rollback/admin_exports_more.sql (restores the list of 22 datasets).
begin;

-- The original list becomes part "a"; the new datasets are part "b"; qb_export_defs() joins them.
create or replace function public.qb_export_defs_a() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
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

create or replace function public.qb_export_defs_b() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
language sql immutable set search_path = '' as $fn$
  select * from (values
    ('interschool_competitions'::text, 'Interschool competitions'::text, 'Competitions'::text, 'Created'::text, 'Status (exact name, for example DRAFT)'::text, null::text[], 'competitions'::text, 'public.competitions'::text, 'Each interschool competition with dates, entry fee, prize pool, teams and sponsor.'::text),
    ('competition_results', 'Competition results', 'Competitions', 'Calculated', 'Result status (exact name)', null::text[], 'competitions', 'public.competition_results', 'Scores, ranks and times. Teams and learners appear as an anonymous code.'),
    ('sponsors', 'Sponsors', 'Competitions', 'Registered', 'Verification (exact name, for example PENDING)', null::text[], 'admin', 'public.sponsor_profiles', 'Sponsor organisations, contacts and verification.'),
    ('classes', 'Classes', 'Schools and learning', 'Created', 'Grade (for example B7)', null::text[], 'admin', 'public.classes', 'Classes with school, grade, term, learner count and teacher. Join codes are not exported.'),
    ('class_results', 'Class results', 'Schools and learning', 'Graded', 'Subject (exact name)', null::text[], 'admin', 'public.gradebook', 'Graded assignment results with score and percentage. Learners appear as an anonymous code.'),
    ('assignments', 'Assignments', 'Schools and learning', 'Created', 'Status', array['draft', 'published', 'closed']::text[], 'admin', 'public.assignments', 'Assignments with subject, grade, due date and status.'),
    ('notifications', 'Notifications sent', 'Schools and learning', 'Sent', 'Type (exact name)', null::text[], 'admin', 'public.notifications', 'How many notifications were sent, of what type, and whether they were read. No message text.'),
    ('teachers', 'Teachers', 'People and audit', 'Joined', 'Status', array['active', 'inactive', 'archived']::text[], 'owner', 'public.teacher_profiles', 'Teachers with school, region, classes and learner counts.'),
    ('learners', 'Learners', 'People and audit', 'Joined', 'Grade (for example B7)', null::text[], 'owner', 'public.student_profiles', 'Learner accounts by grade, school and region. Teacher-managed children are left out.')
  ) as v(key, label, grp, date_label, category_label, categories, need, tbl, descr);
$fn$;

create or replace function public.qb_export_defs() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
language sql immutable set search_path = '' as $fn$
  select * from public.qb_export_defs_a() union all select * from public.qb_export_defs_b();
$fn$;

create or replace function public.qb_export_build_f(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'interschool_competitions' then
    v_cols := array['Created (UTC)', 'Title', 'Type', 'Subject', 'Grade', 'Status', 'Starts (UTC)', 'Ends (UTC)', 'Entry fee', 'Prize pool', 'Currency', 'Participant limit', 'Teams', 'Sponsor'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.title, c.competition_type, c.subject_code, c.grade, c.status, public.qb_export_ts(c.starts_at), public.qb_export_ts(c.ends_at), c.entry_fee, c.prize_pool, c.currency, c.participant_limit,
        (select count(*) from public.competition_teams t where t.competition_id = c.id), sp.organization_name) as r
      from public.competitions c left join public.sponsor_profiles sp on sp.id = c.sponsor_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'competition_results' then
    v_cols := array['Calculated (UTC)', 'Competition', 'Entity type', 'Entity code', 'Score', 'Percent', 'Seconds taken', 'Rank', 'Status'];
    with f as (select r0.calculated_at as k, jsonb_build_array(public.qb_export_ts(r0.calculated_at), c.title, r0.entity_type, left(md5(r0.entity_id::text), 10), r0.score, r0.percentage, round(r0.completion_time_ms / 1000.0, 1), r0.rank, r0.result_status) as r
      from public.competition_results r0 left join public.competitions c on c.id = r0.competition_id
      where (p_from is null or r0.calculated_at >= p_from) and (p_to is null or r0.calculated_at < p_to) and (p_category is null or r0.result_status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'sponsors' then
    v_cols := array['Registered (UTC)', 'Organisation', 'Type', 'Contact', 'Email', 'Country', 'Verification', 'Status'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), s.organization_name, s.sponsor_type, s.contact_name, u.email, s.country, s.verification_status, s.status) as r
      from public.sponsor_profiles s left join public.profiles u on u.id = s.user_id
      where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.verification_status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_g(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'classes' then
    v_cols := array['Created (UTC)', 'Class', 'School', 'Grade', 'Term', 'Academic year', 'Status', 'Active learners', 'Teacher email'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.class_name, c.school_name, c.grade::text, c.term, c.academic_year, lower(c.status::text),
        (select count(*) from public.class_memberships m where m.class_id = c.id and lower(m.status::text) = 'active'), u.email) as r
      from public.classes c left join public.profiles u on u.id = c.teacher_user_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.grade::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'class_results' then
    v_cols := array['Graded (UTC)', 'Class', 'School', 'Assignment', 'Subject', 'Grade', 'Learner code', 'Score', 'Out of', 'Percent', 'Status'];
    with f as (select g.graded_at as k, jsonb_build_array(public.qb_export_ts(g.graded_at), c.class_name, c.school_name, a.title, a.subject_name, a.grade::text, left(md5(g.student_user_id::text), 10), g.score, g.total_marks, g.percentage, g.status) as r
      from public.gradebook g left join public.classes c on c.id = g.class_id left join public.assignments a on a.id = g.assignment_id
      where (p_from is null or g.graded_at >= p_from) and (p_to is null or g.graded_at < p_to) and (p_category is null or a.subject_name = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'assignments' then
    v_cols := array['Created (UTC)', 'Title', 'Subject', 'Grade', 'Class', 'Questions', 'Due (UTC)', 'Status', 'Published (UTC)', 'Teacher email'];
    with f as (select a.created_at as k, jsonb_build_array(public.qb_export_ts(a.created_at), a.title, a.subject_name, a.grade::text, c.class_name, a.question_count, public.qb_export_ts(a.due_at), a.status::text, public.qb_export_ts(a.published_at), u.email) as r
      from public.assignments a left join public.classes c on c.id = a.class_id left join public.profiles u on u.id = a.teacher_user_id
      where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to) and (p_category is null or a.status::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'notifications' then
    v_cols := array['Sent (UTC)', 'Type', 'Title', 'Recipient role', 'Read', 'Read (UTC)'];
    with f as (select n.created_at as k, jsonb_build_array(public.qb_export_ts(n.created_at), n.type, left(n.title, 120), lower(n.recipient_role::text), n.read_at is not null, public.qb_export_ts(n.read_at)) as r
      from public.notifications n
      where (p_from is null or n.created_at >= p_from) and (p_to is null or n.created_at < p_to) and (p_category is null or n.type = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_h(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'teachers' then
    v_cols := array['Joined (UTC)', 'Name', 'Email', 'School', 'Region', 'Status', 'Classes', 'Active learners'];
    with f as (select t.created_at as k, jsonb_build_array(public.qb_export_ts(t.created_at), u.full_name, u.email, t.school_name, t.region, lower(t.status::text),
        (select count(*) from public.classes c where c.teacher_user_id = t.user_id), (select count(*) from public.class_memberships m join public.classes c on c.id = m.class_id where c.teacher_user_id = t.user_id and lower(m.status::text) = 'active')) as r
      from public.teacher_profiles t left join public.profiles u on u.id = t.user_id
      where (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to) and (p_category is null or lower(t.status::text) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'learners' then
    v_cols := array['Joined (UTC)', 'Name', 'Email', 'Grade', 'School', 'Region', 'Status'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), u.full_name, u.email, s.grade::text, s.school_name, s.region, lower(s.status::text)) as r
      from public.student_profiles s left join public.profiles u on u.id = s.user_id
      where not coalesce(s.is_minor, false)
        and (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.grade::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb;
begin
  r := coalesce(public.qb_export_build_a(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_b(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_c(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_d(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_e(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_f(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_g(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_h(p_dataset, p_from, p_to, p_category, p_limit));
  if r is null then raise exception 'QB_UNKNOWN_DATASET' using errcode = '22023'; end if;
  return r;
end $fn$;

revoke all on function public.qb_export_defs_a(), public.qb_export_defs_b(), public.qb_export_defs(), public.qb_export_build(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_f(text, timestamptz, timestamptz, text, integer), public.qb_export_build_g(text, timestamptz, timestamptz, text, integer), public.qb_export_build_h(text, timestamptz, timestamptz, text, integer) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
