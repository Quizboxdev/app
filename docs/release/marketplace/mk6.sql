create or replace function public.qb_mk_prepare_purchase(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.marketplace') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into it from public.mk_items where id = p_item and status = 'approved';
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if s.status <> 'verified' then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.user_id = auth.uid() then raise exception 'QB_OWN_ITEM' using errcode = '55000'; end if;
  if exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.is_minor) then raise exception 'QB_MINOR_CANNOT_PAY' using errcode = '55000'; end if;
  if exists (select 1 from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now()) then raise exception 'QB_ALREADY_OWNED' using errcode = '55000'; end if;
  return jsonb_build_object('item_id', it.id, 'title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'seller', s.display_name, 'price_minor', it.price_minor, 'seller_id', s.id);
end $fn$;

create or replace function public.qb_mk_my_purchases() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', p.item_id, 'slug', i.slug, 'title', p.item_title, 'subject', p.item_subject, 'school', p.item_school, 'grade', p.item_grade, 'price_minor', p.price_minor,
      'purchased_at', p.purchased_at, 'expires_at', p.expires_at, 'active', p.status = 'active' and p.expires_at > now(), 'days_left', greatest(0, ceil(extract(epoch from (p.expires_at - now())) / 86400))::int, 'status', p.status) order by p.purchased_at desc)
    from public.mk_purchases p join public.mk_items i on i.id = p.item_id where p.buyer_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

-- The questions, with answers, for someone who may have them: a buyer inside the 90 days, the seller, or reviewing staff.
create or replace function public.qb_mk_open(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers; v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_item;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  select max(expires_at) into v_until from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now();
  if v_until is null and s.user_id <> auth.uid() and not public.qb_mk_is_staff('review') then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  return jsonb_build_object('title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'term', it.term, 'expires_at', v_until,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

create or replace function public.qb_mk_record_attempt(p_item uuid, p_correct integer, p_total integer) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.mk_purchases where item_id = p_item and buyer_user_id = auth.uid() and status = 'active' and expires_at > now()) then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  if p_total is null or p_total < 1 or p_correct is null or p_correct < 0 or p_correct > p_total then raise exception 'QB_INVALID_ATTEMPT' using errcode = '22023'; end if;
  insert into public.mk_attempts(item_id, user_id, correct, total) values (p_item, auth.uid(), p_correct, p_total);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Payment: the checkout records the cart on the payment, then settlement records the sale (server only)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_set_payment_item(p_reference text, p_item uuid, p_price_minor bigint) returns void language plpgsql security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  select * into it from public.mk_items where id = p_item; select * into s from public.mk_sellers where id = it.seller_id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_price_minor is distinct from it.price_minor::bigint then raise exception 'QB_PRICE_CHANGED' using errcode = '55000'; end if;
  update public.payment_intents set metadata = metadata || jsonb_build_object('purpose', 'marketplace', 'item_id', it.id, 'price_minor', p_price_minor, 'item_title', it.title, 'item_subject', it.subject, 'item_school', it.school_name,
    'item_grade', it.grade, 'seller_id', s.id, 'seller', s.display_name)
   where reference = p_reference and status in ('initiated', 'pending', 'awaiting_approval', 'processing');
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
end $fn$;

