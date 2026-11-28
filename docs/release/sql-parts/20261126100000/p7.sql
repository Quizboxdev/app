create or replace function public.interschool_manage_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return jsonb_build_object(
    'can_create', jsonb_build_object('admin', quizbox_interschool.is_admin(), 'sponsor', quizbox_interschool.approved_sponsor(),
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.institutions i where i.id in (select quizbox_interschool.my_schools())), '[]'::jsonb)),
    'competitions', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select c.id, c.slug, c.title, c.status, c.participation, c.scale, c.funding, c.capacity, c.organiser_kind, c.approved_at is not null as approved, c.decision_note,
             c.registration_closes_at, c.opens_at, c.ends_at, c.created_at
        from quizbox_interschool.competitions c where quizbox_interschool.can_manage(c) order by c.created_at desc limit 200) x), '[]'::jsonb));
end $fn$;

-- Subjects and topics an organiser can pick for a level, with the number of usable questions under each.
create or replace function public.interschool_subjects(p_levels text[]) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare lv text[];
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  select array_agg(upper(btrim(x))) into lv from unnest(p_levels) x;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'level', upper(coalesce(n.canonical_grade_code, n.grade_code)),
      'questions', (select count(*) from quizbox_interschool.pool(lv, n.id, null))) order by upper(coalesce(n.canonical_grade_code, n.grade_code)), n.title)
    from public.curriculum_nodes n where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = any(lv)), '[]'::jsonb);
end $fn$;
create or replace function public.interschool_topics(p_subject uuid, p_parent uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare lv text[];
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  select array[upper(coalesce(canonical_grade_code, grade_code))] into lv from public.curriculum_nodes where id = p_subject and node_type = 'subject';
  if lv is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'code', n.code, 'type', n.node_type,
      'questions', (select count(*) from quizbox_interschool.pool(lv, p_subject, array[n.id]))) order by n.code, n.title)
    from public.curriculum_nodes n where n.is_active and n.parent_id = coalesce(p_parent, p_subject)), '[]'::jsonb);
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' or (n.nspname = 'public' and p.proname like 'interschool\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.interschool_create(jsonb, uuid), public.interschool_update(uuid, jsonb), public.interschool_set_divisions(uuid, jsonb), public.interschool_set_rounds(uuid, jsonb), public.interschool_check(uuid),
  public.interschool_request_approval(uuid), public.interschool_decide(uuid, boolean, text), public.interschool_publish(uuid), public.interschool_set_status(uuid, text, text), public.interschool_duplicate(uuid),
  public.interschool_manage_get(uuid), public.interschool_manage_list(), public.interschool_subjects(text[]), public.interschool_topics(uuid, uuid) to authenticated;


notify pgrst, 'reload schema';
