-- READ-ONLY. Run on Preview or Production before applying 20261120100000_learner_profile_write_guards.sql (and again after).
-- Shows (1) whether the weak rules are present, (2) whether the correction would refuse to apply, (3) any sign the weaknesses were already used.
-- It writes nothing and is safe to run in a read-only session:  run_readonly_sql.ps1 -Target Production -File <this file>
\pset format unaligned
\pset null '(none)'
select '--- 1. Rules on the three tables (before: student_self, teacher_self and assignments_teacher_owner as FOR ALL; after: *_read policies only)' as section;
select polrelid::regclass::text as table_name, polname, case polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end as command,
       pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy where polrelid in ('public.student_profiles'::regclass, 'public.teacher_profiles'::regclass, 'public.assignments'::regclass) order by 1, 2;
select '--- 2. Write privileges held by browser roles on the two profile tables (after the correction: none)' as section;
select c.relname as table_name, r.rolname as role, string_agg(p.priv, ',' order by p.priv) as privileges
from pg_class c cross join (values ('authenticated'), ('anon')) r(rolname) cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
where c.relnamespace = 'public'::regnamespace and c.relname in ('student_profiles', 'teacher_profiles') and has_table_privilege(r.rolname, c.oid, p.priv)
group by 1, 2 order by 1, 2;
select '--- 3. Would the correction apply? Class codes that differ only by letter case (must be none), short or odd codes already present (allowed, only counted)' as section;
select count(*) as classes, count(*) filter (where char_length(join_code) < 10 or join_code !~ '^[A-Za-z0-9-]+$') as old_short_or_odd_codes from public.classes;
select upper(join_code) as code_ignoring_case, count(*) as classes_sharing_it from public.classes group by 1 having count(*) > 1;
select '--- 4. Signs the weaknesses were already used (counts only, no names)' as section;
select 'teacher profiles owned by a learner account' as what, count(*) as n from public.teacher_profiles tp join public.profiles p on p.id = tp.user_id where lower(p.role::text) = 'student'
union all
select 'classes whose owning teacher account is a learner account', count(*) from public.classes c join public.profiles p on p.id = c.teacher_user_id where lower(p.role::text) = 'student'
union all
select 'learners flagged minor with no guardian and no managed_by', count(*) from public.student_profiles where is_minor and managed_by is null
union all
select 'learners whose managed_by is not an adult account', count(*) from public.student_profiles sp join public.profiles p on p.id = sp.managed_by where lower(p.role::text) = 'student'
union all
select 'assignments written into a class owned by a different teacher (co-teaching and school managers are legitimate: review the number, not just non-zero)', count(*)
  from public.assignments a join public.classes c on c.id = a.class_id where a.teacher_user_id is distinct from c.teacher_user_id;
