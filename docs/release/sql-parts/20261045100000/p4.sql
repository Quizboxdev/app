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
