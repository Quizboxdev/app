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

