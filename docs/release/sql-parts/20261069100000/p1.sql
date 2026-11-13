begin;
-- A signed-in teacher can correct their own name, school, subjects and grades taught (flag flags.teacher_profile_edit, default OFF).
-- Unlike a learner (two edits in six months, because a class level moves their whole practice), a teacher's details are corrected as their work changes, so there is no count limit.
-- Every save is kept, with before and after, in public.account_profile_edits and in the audit log. A teacher who belongs to a school's organisation (institution_id set) cannot change the school here:
-- it follows the organisation, which the school administrator manages. Country stays a reviewed request. A save that changes nothing is refused.
--   public.qb_teacher_profile_status()                                  whether the screen is on, who may edit, whether the school is locked
--   public.qb_update_teacher_profile(name, school, subjects, grades)    saves the change (NULL means "leave as it is"); education levels follow the grades chosen
-- Errors: QB_FEATURE_DISABLED, NOT_A_TEACHER, INVALID_NAME, QB_SCHOOL_REQUIRED, SCHOOL_LOCKED, INVALID_GRADE, INVALID_SUBJECT, NOTHING_CHANGED.
-- Sponsors and SME reviewers are separate changes that reuse this history table (kind column).
-- Rollback: supabase/rollback/teacher_profile_edit.sql

insert into public.platform_settings(key, value, description) values
  ('flags.teacher_profile_edit', 'false', 'A teacher can edit their own name, school, subjects and grades taught')
on conflict do nothing;

create table if not exists public.account_profile_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('teacher', 'sponsor', 'sme')),
  edited_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists account_profile_edits_user_idx on public.account_profile_edits(user_id, edited_at desc);
alter table public.account_profile_edits enable row level security;
revoke all on public.account_profile_edits from public, anon, authenticated;

create or replace function public.qb_teacher_profile_status() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); tp public.teacher_profiles; why text;
begin
  if uid is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into tp from public.teacher_profiles where user_id = uid and lower(status::text) = 'active' limit 1;
  if not found or not exists (select 1 from public.profiles p where p.id = uid and lower(p.role::text) = 'teacher') then why := 'NOT_A_TEACHER'; end if;
  return jsonb_build_object('enabled', quizbox_core.flag('flags.teacher_profile_edit'), 'eligible', why is null, 'reason', why,
    'school_locked', coalesce(tp.institution_id is not null, false));
end $fn$;

create or replace function public.qb_update_teacher_profile(p_full_name text default null, p_school text default null, p_subjects text[] default null, p_grade_codes text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); pr public.profiles; tp public.teacher_profiles; cfg jsonb; s text; g text;
  v_name text; v_school text; v_subjects text[]; v_grades text[]; v_levels text[]; before_v jsonb; after_v jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.teacher_profile_edit') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into pr from public.profiles where id = uid;
  select * into tp from public.teacher_profiles where user_id = uid and lower(status::text) = 'active' limit 1 for update;
  if not found or lower(pr.role::text) <> 'teacher' then raise exception 'NOT_A_TEACHER' using errcode = '42501'; end if;
  select m.configuration into cfg from public.markets m where m.id = coalesce(pr.primary_market_id, pr.default_market_id);

  v_name := case when p_full_name is null then pr.full_name else left(btrim(p_full_name), 150) end;
  if char_length(btrim(v_name)) < 2 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;

  v_school := case when p_school is null then tp.school_name else left(btrim(p_school), 200) end;
  if nullif(btrim(v_school), '') is null then raise exception 'QB_SCHOOL_REQUIRED' using errcode = '22023'; end if;
  if tp.institution_id is not null and v_school is distinct from tp.school_name then raise exception 'SCHOOL_LOCKED' using errcode = '42501'; end if;

  if p_subjects is null then v_subjects := array(select distinct x from unnest(coalesce(tp.subjects, '{}')) x order by x);
  else
    if cardinality(p_subjects) > 20 then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
    foreach s in array p_subjects loop
      if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'subjects', '[]')) x where x->>'code' = s) then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
    end loop;
    v_subjects := array(select distinct x from unnest(p_subjects) x order by x);
  end if;

  if p_grade_codes is null then v_grades := array(select distinct x from unnest(coalesce(tp.grade_codes, '{}')) x order by x); v_levels := coalesce(tp.education_levels, '{}');
  else
    if cardinality(p_grade_codes) > 30 then raise exception 'INVALID_GRADE' using errcode = '22023'; end if;
    foreach g in array p_grade_codes loop
      if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'grades', '[]')) x where x->>'code' = g) then raise exception 'INVALID_GRADE' using errcode = '22023'; end if;
    end loop;
    v_grades := array(select distinct x from unnest(p_grade_codes) x order by x);
    v_levels := array(select distinct x->>'level' from jsonb_array_elements(coalesce(cfg->'grades', '[]')) x where x->>'code' = any(v_grades) and nullif(x->>'level', '') is not null order by 1);
  end if;

  before_v := jsonb_build_object('full_name', pr.full_name, 'school_name', tp.school_name, 'subjects', to_jsonb(array(select distinct x from unnest(coalesce(tp.subjects, '{}')) x order by x)),
    'grade_codes', to_jsonb(array(select distinct x from unnest(coalesce(tp.grade_codes, '{}')) x order by x)));
  after_v := jsonb_build_object('full_name', v_name, 'school_name', v_school, 'subjects', to_jsonb(v_subjects), 'grade_codes', to_jsonb(v_grades));
  if before_v = after_v then raise exception 'NOTHING_CHANGED' using errcode = '22023'; end if;

  update public.profiles set full_name = v_name, school_name = v_school where id = uid;
  update public.teacher_profiles set school_name = v_school, subjects = v_subjects, grade_codes = v_grades, education_levels = v_levels, updated_at = now() where id = tp.id;
  insert into public.account_profile_edits(user_id, kind, before, after) values (uid, 'teacher', before_v, after_v);
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (uid, 'teacher_profile_edited', 'teacher_profile', tp.id, 'ok', jsonb_build_object('before', before_v, 'after', after_v));
  return jsonb_build_object('ok', true) || public.qb_teacher_profile_status();
end $fn$;

revoke all on function public.qb_teacher_profile_status(), public.qb_update_teacher_profile(text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.qb_teacher_profile_status(), public.qb_update_teacher_profile(text, text, text[], text[]) to authenticated;

commit;
notify pgrst, 'reload schema';
