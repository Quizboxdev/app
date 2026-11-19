-- December 2026 release-readiness gate: corrections for defects D-01 to D-04 (docs/release-readiness/DEC-2026-GATE.md).
-- Found by supabase/tests/december_readiness_gate.sql against a database built from the production schema plus this repository's migrations.
--
-- D-01  A learner could give themselves a teacher profile (and then create classes), and could edit their own is_minor / managed_by flags.
--       Cause: policies student_self and teacher_self (initial schema) allow every command on the user's own row, and the browser roles hold
--       table-level INSERT/UPDATE/DELETE. The app never writes these two tables from the browser (lib/auth.ts only reads them); every write
--       goes through SECURITY DEFINER functions or the service role, which this change does not touch.
-- D-02  A teacher could write an assignment row into another teacher's class by editing public.assignments directly (the policy checked only the owner).
-- D-03  Two classes could share one join code in different letter case, while joining matches case-insensitively.
-- D-04  The browser chose the join code, and the server accepted any text, however short.
--
-- Safe to apply more than once. Rollback: supabase/rollback/learner_profile_write_guards.sql.

-- D-01 -------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists student_self on public.student_profiles;
drop policy if exists student_self_read on public.student_profiles;
create policy student_self_read on public.student_profiles for select using (user_id = auth.uid());
drop policy if exists teacher_self on public.teacher_profiles;
drop policy if exists teacher_self_read on public.teacher_profiles;
create policy teacher_self_read on public.teacher_profiles for select using (user_id = auth.uid());
revoke insert, update, delete on public.student_profiles from authenticated, anon;
revoke insert, update, delete on public.teacher_profiles from authenticated, anon;

-- D-02 -------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists assignments_teacher_owner on public.assignments;
create policy assignments_teacher_owner on public.assignments for all
  using (teacher_user_id = (select auth.uid()))
  with check (teacher_user_id = (select auth.uid()) and (class_id is null or public.qb_can_manage_class(class_id)));

-- D-03 and D-04 ----------------------------------------------------------------------------------------------------------------------------
do $$
declare dup text;
begin
  select string_agg(distinct upper(join_code), ', ') into dup from (select upper(join_code) u, join_code from public.classes) s
   where u in (select upper(join_code) from public.classes group by 1 having count(*) > 1);
  if dup is not null then raise exception 'CLASS_JOIN_CODE_DUPLICATES: resolve these codes (same code in different letter case) before applying: %', dup; end if;
end $$;
create unique index if not exists classes_join_code_upper_key on public.classes (upper(join_code));

create schema if not exists quizbox_private;
create or replace function quizbox_private.class_join_code_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only a new or changed code is checked, so existing classes with older, shorter codes can still be renamed or archived.
  if tg_op = 'INSERT' or new.join_code is distinct from old.join_code then
    if new.join_code is null or char_length(new.join_code) < 10 or char_length(new.join_code) > 64 or new.join_code !~ '^[A-Za-z0-9-]+$' then
      raise exception 'QB_CLASS_CODE_WEAK' using errcode = '22023', hint = 'A class code needs 10 to 64 letters, numbers or hyphens.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists class_join_code_guard on public.classes;
create trigger class_join_code_guard before insert or update of join_code on public.classes for each row execute function quizbox_private.class_join_code_guard();
