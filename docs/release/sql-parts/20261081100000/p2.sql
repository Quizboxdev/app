create or replace function public.qb_family_class(p_grade_code text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w public.family_workspaces; par public.profiles; ids uuid[]; tp uuid; c public.classes; cur uuid; mkt uuid; lvl text; g text := btrim(coalesce(p_grade_code, ''));
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select * into w from public.family_workspaces where owner_user_id = uid;
  if w.id is null or g = '' then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into par from public.profiles where id = uid;
  ids := array(select sp.user_id from public.account_relationships r join public.student_profiles sp on sp.user_id = r.target_user_id
                where r.source_user_id = uid and r.family_workspace_id = w.id and r.status = 'active' and lower(sp.status::text) = 'active' and sp.grade_code = g
                  and quizbox_core.family_can(uid, r.target_user_id, 'assign'));
  if coalesce(cardinality(ids), 0) = 0 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  insert into public.teacher_profiles(user_id, school_name, country) values (uid, 'Family workspace', coalesce(par.country, 'Ghana')) on conflict (user_id) do nothing;
  select id into tp from public.teacher_profiles where user_id = uid;
  select * into c from public.classes where family_workspace_id = w.id and grade_code = g;
  if c.id is null then
    mkt := coalesce(par.primary_market_id, par.default_market_id);
    select education_level into lvl from public.student_profiles where user_id = ids[1];
    select n.curriculum_id into cur from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active and mc.market_id = mkt
     where coalesce(n.canonical_grade_code, n.grade_code) = g limit 1;
    insert into public.classes(join_code, class_name, grade, grade_label, grade_code, teacher_id, teacher_user_id, primary_teacher_id, status, curriculum_id, education_level, family_workspace_id)
    values ('FAM' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)), 'Family · ' || g,
            case when exists (select 1 from pg_enum where enumtypid = 'public.qb_grade'::regtype and enumlabel = g) then g::public.qb_grade else null end,
            g, g, tp, uid, tp, 'active', cur, lvl, w.id) returning * into c;
  end if;
  update public.class_memberships m set status = 'active', left_at = null where m.class_id = c.id and m.student_user_id = any(ids) and m.status::text <> 'active';
  insert into public.class_memberships(class_id, student_id, student_user_id, student_email, student_name, grade, status, approved_at)
  select c.id, sp.id, sp.user_id, coalesce(p.email, ''), coalesce(p.full_name, ''), sp.grade, 'active', now()
    from public.student_profiles sp join public.profiles p on p.id = sp.user_id
   where sp.user_id = any(ids) and not exists (select 1 from public.class_memberships m where m.class_id = c.id and m.student_id = sp.id);
  return jsonb_build_object('class_id', c.id, 'grade_code', g, 'curriculum_id', c.curriculum_id,
    'learners', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb) from public.profiles p where p.id = any(ids)));
end $fn$;
