begin;
-- A signed-in learner can correct their own class level, school and subjects (for example a learner who signed up at the wrong class level, or who now takes French). The rule, set by the owner:
-- two edits in any six months. Each saved edit counts for six months from the day it was made, so after the first edit one is left, after the second none is left until the first is six months old.
-- Opening the form and cancelling costs nothing, and a save that changes nothing is refused without costing an edit.
--   public.qb_profile_edit_status()                           who may edit, how many edits are used and left, and when the next one opens
--   public.qb_update_student_profile(grade, school, subjects) saves the change (NULL means "leave as it is"; an empty school clears it) and records before and after
-- Only a self-registered learner can use this. A learner managed by a teacher or guardian (under 13) is changed by that adult, not by the child. Country stays a reviewed request.
-- Errors: NOT_A_STUDENT, MANAGED_ACCOUNT, PROFILE_EDIT_LIMIT, INVALID_GRADE, INVALID_SUBJECT, NOTHING_CHANGED.
-- Rollback: supabase/rollback/student_profile_edits.sql

create table if not exists public.student_profile_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  edited_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists student_profile_edits_user_idx on public.student_profile_edits(user_id, edited_at desc);
alter table public.student_profile_edits enable row level security;
revoke all on public.student_profile_edits from public, anon, authenticated;

create or replace function public.qb_profile_edit_status() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); sp public.student_profiles; used integer; remaining integer; nxt timestamptz; last_at timestamptz; why text;
  v_limit constant integer := 2;
begin
  if uid is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into sp from public.student_profiles where user_id = uid and lower(status::text) = 'active' limit 1;
  if not found or not exists (select 1 from public.profiles p where p.id = uid and lower(p.role::text) = 'student') then why := 'NOT_A_STUDENT';
  elsif sp.managed_by is not null then why := 'MANAGED_ACCOUNT'; end if;
  select count(*)::int, min(edited_at), max(edited_at) into used, nxt, last_at from public.student_profile_edits where user_id = uid and edited_at > now() - interval '6 months';
  remaining := greatest(0, v_limit - used);
  return jsonb_build_object('eligible', why is null, 'reason', why, 'limit', v_limit, 'window_months', 6, 'used', used, 'remaining', remaining,
    'next_edit_at', case when remaining = 0 then nxt + interval '6 months' end, 'last_edit_at', last_at);
end $fn$;

create or replace function public.qb_update_student_profile(p_grade text default null, p_school text default null, p_subjects text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); sp public.student_profiles; pr public.profiles; cfg jsonb; g jsonb; st jsonb;
  v_grade text; v_level text; v_school text; v_subjects text[]; s text; before_v jsonb; after_v jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = uid;
  select * into sp from public.student_profiles where user_id = uid and lower(status::text) = 'active' limit 1 for update;
  if not found or lower(pr.role::text) <> 'student' then raise exception 'NOT_A_STUDENT' using errcode = '42501'; end if;
  if sp.managed_by is not null then raise exception 'MANAGED_ACCOUNT' using errcode = '42501'; end if;
  st := public.qb_profile_edit_status();
  if (st->>'remaining')::int <= 0 then raise exception 'PROFILE_EDIT_LIMIT' using errcode = '55000'; end if;
  select m.configuration into cfg from public.markets m where m.id = coalesce(pr.primary_market_id, pr.default_market_id);
  v_grade := coalesce(nullif(btrim(p_grade), ''), sp.grade_code, sp.grade::text); v_level := sp.education_level;
  if nullif(btrim(p_grade), '') is not null and btrim(p_grade) is distinct from coalesce(sp.grade_code, sp.grade::text) then
    select x into g from jsonb_array_elements(coalesce(cfg->'grades', '[]')) x where x->>'code' = btrim(p_grade) limit 1;
    if g is null then raise exception 'INVALID_GRADE' using errcode = '22023'; end if;
    v_grade := g->>'code'; v_level := coalesce(g->>'level', sp.education_level);
  end if;
  v_school := case when p_school is null then sp.school_name else nullif(left(btrim(p_school), 200), '') end;
  if p_subjects is null then v_subjects := array(select distinct x from unnest(coalesce(sp.subjects, '{}')) x order by x);
  else
    if cardinality(p_subjects) > 20 then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
    foreach s in array p_subjects loop
      if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'subjects', '[]')) x where x->>'code' = s) then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
    end loop;
    v_subjects := array(select distinct x from unnest(p_subjects) x order by x);
  end if;
  before_v := jsonb_build_object('grade_code', coalesce(sp.grade_code, sp.grade::text), 'education_level', sp.education_level, 'school_name', sp.school_name, 'subjects', to_jsonb(array(select distinct x from unnest(coalesce(sp.subjects, '{}')) x order by x)));
  after_v := jsonb_build_object('grade_code', v_grade, 'education_level', v_level, 'school_name', v_school, 'subjects', to_jsonb(coalesce(v_subjects, '{}')));
  if before_v = after_v then raise exception 'NOTHING_CHANGED' using errcode = '22023'; end if;
  update public.student_profiles set
    grade = case when exists (select 1 from pg_enum where enumtypid = 'public.qb_grade'::regtype and enumlabel = v_grade) then v_grade::public.qb_grade else null end,
    grade_code = v_grade, education_level = v_level, school_name = v_school, subjects = coalesce(v_subjects, '{}'), updated_at = now()
   where id = sp.id;
  update public.profiles set school_name = v_school where id = uid;
  insert into public.student_profile_edits(user_id, before, after) values (uid, before_v, after_v);
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (uid, 'student_profile_edited', 'student_profile', sp.id, 'ok', jsonb_build_object('before', before_v, 'after', after_v));
  return jsonb_build_object('ok', true) || public.qb_profile_edit_status();
end $fn$;

revoke all on function public.qb_profile_edit_status(), public.qb_update_student_profile(text, text, text[]) from public, anon, authenticated;
grant execute on function public.qb_profile_edit_status(), public.qb_update_student_profile(text, text, text[]) to authenticated;

commit;
notify pgrst, 'reload schema';
