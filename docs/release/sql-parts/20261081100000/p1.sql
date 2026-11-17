-- Family workspace, phase 4a: a parent gives their children work through the same assignment engine teachers use (no second engine).
-- A parent's work lives in a hidden "family class" per class level (one per workspace and grade), owned by the parent. It holds only the parent's own linked children, so a school class is never touched
-- and a child who is also in a school class keeps both. Every assignment made in a family class is stamped source_type = 'family' and the workspace it came from, so the student can tell school work from family work.
--   public.qb_family_class(grade_code)   the parent's family class for that grade (made on first use), with the children of that grade the parent may give work to; the app then uses the existing topic functions with this class
--   public.qb_family_assignments()       the parent's assignments with each child's progress, only for children the parent may follow
-- Reuses: classes, class_memberships, teacher_profiles, qb_teacher_topics / qb_topic_assignment_plan / qb_publish_topic_assignment, assignments, assignment_targets, attempts. Off with the rest of the workspace (flags.family_workspace).
-- Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN. Additive and idempotent. Rollback: supabase/rollback/family_assignments.sql
begin;

alter table public.classes add column if not exists family_workspace_id uuid references public.family_workspaces(id) on delete set null;
create unique index if not exists classes_family_grade on public.classes(family_workspace_id, grade_code) where family_workspace_id is not null;

alter table public.assignments add column if not exists source_type text not null default 'school';
alter table public.assignments add column if not exists workspace_id uuid references public.family_workspaces(id) on delete set null;
alter table public.assignments drop constraint if exists assignments_source_type_check;
alter table public.assignments add constraint assignments_source_type_check check (source_type in ('school', 'family', 'system', 'self'));

create or replace function quizbox_core.assignment_source() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare w uuid;
begin
  select c.family_workspace_id into w from public.classes c where c.id = new.class_id;
  if w is not null then new.source_type := 'family'; new.workspace_id := w; end if;
  return new;
end $fn$;
drop trigger if exists assignment_source on public.assignments;
create trigger assignment_source before insert on public.assignments for each row execute function quizbox_core.assignment_source();

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

create or replace function public.qb_family_assignments() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
    select a.created_at, jsonb_build_object('assignment_id', a.id, 'title', a.title, 'grade_code', coalesce(a.grade_code, a.grade::text), 'due_at', a.due_at, 'published_at', a.published_at,
      'question_count', a.question_count, 'mode', a.mode,
      'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', sp.user_id, 'name', p.full_name,
          'status', case when exists (select 1 from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id and at.submitted_at is not null) then 'done'
                         when exists (select 1 from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id) then 'started' else 'not_started' end,
          'percentage', (select max(at.percentage) from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id and at.submitted_at is not null)) order by p.full_name)
        from public.assignment_targets t join public.student_profiles sp on sp.id = t.student_id join public.profiles p on p.id = sp.user_id
        where t.assignment_id = a.id and quizbox_core.family_can(uid, sp.user_id, 'view_progress')), '[]'::jsonb)) as j
    from public.assignments a where a.workspace_id = w and a.source_type = 'family' order by a.created_at desc limit 50) x), '[]'::jsonb);
end $fn$;

revoke all on function quizbox_core.assignment_source() from public, anon, authenticated;
revoke all on function public.qb_family_class(text), public.qb_family_assignments() from public, anon, authenticated;
grant execute on function public.qb_family_class(text), public.qb_family_assignments() to authenticated;

commit;
notify pgrst, 'reload schema';
