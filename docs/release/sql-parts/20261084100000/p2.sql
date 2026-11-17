create or replace function public.qb_family_set_open(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select max(p.expires_at) into v_until from public.family_set_grants g join public.mk_purchases p on p.id = g.purchase_id
   where g.student_user_id = auth.uid() and g.item_id = p_item and p.status = 'active' and p.expires_at > now();
  if v_until is null then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_item;
  return jsonb_build_object('title', it.title, 'subject', it.subject, 'school', it.school_name, 'grade', it.grade, 'term', it.term, 'expires_at', v_until,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

create or replace function public.qb_family_set_record(p_item uuid, p_correct integer, p_total integer) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not exists (select 1 from public.family_set_grants g join public.mk_purchases p on p.id = g.purchase_id where g.student_user_id = auth.uid() and g.item_id = p_item and p.status = 'active' and p.expires_at > now()) then raise exception 'QB_NOT_PURCHASED' using errcode = '42501'; end if;
  if p_total is null or p_total < 1 or p_correct is null or p_correct < 0 or p_correct > p_total then raise exception 'QB_INVALID_ATTEMPT' using errcode = '22023'; end if;
  insert into public.mk_attempts(item_id, user_id, correct, total) values (p_item, auth.uid(), p_correct, p_total);
end $fn$;

revoke all on function public.qb_family_library(), public.qb_family_grant_set(uuid, uuid[]), public.qb_family_revoke_grant(uuid, uuid), public.qb_family_my_sets(), public.qb_family_set_open(uuid), public.qb_family_set_record(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_family_library(), public.qb_family_grant_set(uuid, uuid[]), public.qb_family_revoke_grant(uuid, uuid), public.qb_family_my_sets(), public.qb_family_set_open(uuid), public.qb_family_set_record(uuid, integer, integer) to authenticated;


notify pgrst, 'reload schema';
