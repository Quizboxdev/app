-- Public platform figures for the front page, read live from the user and question tables.
-- A reviewed public contract (listed in lib/operations/public-rpc-allowlist.ts): anonymous callers receive COUNTS ONLY. No name, id, email,
-- school or any row-level value leaves the database. Learners are grouped by the level their grade belongs to; questions and curriculum
-- indicators by the education level of the curriculum node they sit on. Test fixtures (source_type DEV_*) and inactive records are excluded.
-- One new function, no table or policy change. Rollback: supabase/rollback/public_platform_stats.sql.
begin;

create or replace function public.qb_public_platform_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  learners jsonb; questions jsonb; indicators jsonb; people jsonb;
begin
  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where lvl = 'PRIMARY'),
      'jhs', count(*) filter (where lvl = 'JHS'),
      'shs', count(*) filter (where lvl = 'SHS'))
    into learners
    from (select case
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^B[1-6]$' then 'PRIMARY'
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^B(7|8|9)$' then 'JHS'
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^(B10|SHS ?[123])$' then 'SHS'
            else upper(coalesce(nullif(s.education_level, ''), 'OTHER')) end as lvl
            from public.student_profiles s where s.status::text = 'active') x;

  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where upper(n.education_level) = 'PRIMARY'),
      'jhs', count(*) filter (where upper(n.education_level) = 'JHS'),
      'shs', count(*) filter (where upper(n.education_level) = 'SHS'))
    into questions
    from public.questions q left join public.curriculum_nodes n on n.id = q.curriculum_node_id
   where q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
     and coalesce(q.source_type, '') not like 'DEV\_%';

  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where upper(n.education_level) = 'PRIMARY'),
      'jhs', count(*) filter (where upper(n.education_level) = 'JHS'),
      'shs', count(*) filter (where upper(n.education_level) = 'SHS'))
    into indicators
    from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
   where n.is_active and n.node_type = 'learning_indicator';

  select jsonb_build_object(
      'teachers', (select count(*) from public.teacher_profiles where status::text = 'active'),
      'reviewers', (select count(*) from public.sme_profiles where active and reviewer_status = 'verified'),
      'schools', (select count(*) from public.institutions where status::text = 'active'),
      'sponsors', (select count(*) from public.sponsor_profiles where upper(coalesce(status::text, '')) not in ('SUSPENDED', 'REJECTED', 'DISABLED', 'ARCHIVED', 'DELETED')),
      'markets', (select count(*) from public.markets where active and not coalesce(is_test, false)))
    into people;

  return jsonb_build_object('learners', learners, 'questions', questions, 'indicators', indicators, 'people', people, 'as_of', now());
end $$;

revoke all on function public.qb_public_platform_stats() from public;
grant execute on function public.qb_public_platform_stats() to anon, authenticated;

commit;
