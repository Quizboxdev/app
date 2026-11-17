-- QuizBox database fingerprint, part B. READ-ONLY: it only looks, it changes nothing.
-- Run the same part on BOTH projects (Preview fngdtxayfoiffbcbmcum and Production fmgccmqxfjppqydkhaiu) and compare the 'status' column row by row.
-- ok = every sampled object of that migration exists; PARTIAL = some do; MISSING = none do (the migration was not applied); data-only = it only inserts rows, so look at the notes.
with c(v, k, o) as (values
  ('20261055100000','t','public.assignment_sections'),
  ('20261055100000','f','quizbox_topic.class_level'),
  ('20261055100000','f','quizbox_topic.blueprint_plan'),
  ('20261055100000','f','public.qb_attempt_breakdown'),
  ('20261056100000','f','public.qb_topics_overview'),
  ('20261056100000','f','public.qb_topics_set_open'),
  ('20261057100000','f','public.qb_start_mixed_practice'),
  ('20261059100000','f','public.qb_bank_subjects'),
  ('20261059100000','f','public.qb_challenge_bank_menu'),
  ('20261059100000','f','public.challenge_pull_bank_sections'),
  ('20261066100000','t','public.student_profile_edits'),
  ('20261066100000','f','public.qb_profile_edit_status'),
  ('20261066100000','f','public.qb_update_student_profile'),
  ('20261067100000','t','public.assignment_schedules'),
  ('20261067100000','t','public.assignment_reminders_sent'),
  ('20261067100000','f','quizbox_sched.next_run'),
  ('20261067100000','f','public.qb_schedule_delete'),
  ('20261067100000','f','public.qb_assignment_reminders_run'),
  ('20261068100000','f','public.qb_school_aiming_on'),
  ('20261068100000','f','public.qb_school_verifier'),
  ('20261068100000','f','public.institution_set_verified'),
  ('20261068100000','c','public.institutions.verified_at'),
  ('20261068100000','c','public.institutions.verified_by'),
  ('20261069100000','t','public.account_profile_edits'),
  ('20261069100000','f','public.qb_teacher_profile_status'),
  ('20261069100000','f','public.qb_update_teacher_profile'),
  ('20261070100000','f','quizbox_staff.capability_of'),
  ('20261070100000','f','public.qb_my_staff_access'),
  ('20261070100000','f','public.qb_staff_set'),
  ('20261072100000','f','public.qb_ql_batches'),
  ('20261074100000','t','public.school_directory'),
  ('20261074100000','f','public.qb_school_key'),
  ('20261074100000','f','public.qb_school_search'),
  ('20261074100000','f','public.qb_school_admin_import'),
  ('20261074100000','c','public.student_profiles.school_directory_id'),
  ('20261074100000','c','public.teacher_profiles.school_directory_id'),
  ('20261075100000','f','public.qb_school_admin_stats'),
  ('20261076100000','t','public.social_channels'),
  ('20261076100000','f','public.qb_social_link'),
  ('20261076100000','f','public.qb_social_admin_save'),
  ('20261076100000','f','public.qb_social_admin_reorder'),
  ('20261077100000','f','public.qb_admin_dashboard'),
  ('20261078100000','f','public.qb_student_set_subjects'),
  ('20261079100000','t','public.family_workspaces'),
  ('20261079100000','f','quizbox_core.family_default_permissions'),
  ('20261079100000','f','public.qb_family_children'),
  ('20261079100000','f','public.qb_family_attach_child'),
  ('20261079100000','c','public.account_relationships.family_workspace_id'),
  ('20261079100000','c','public.account_relationships.permissions'),
  ('20261080100000','t','public.family_invitations'),
  ('20261080100000','f','quizbox_core.family_token_hash'),
  ('20261080100000','f','public.qb_family_invite_peek'),
  ('20261080100000','f','public.qb_family_link_respond'),
  ('20261080100000','c','public.account_relationships.label'),
  ('20261081100000','f','quizbox_core.assignment_source'),
  ('20261081100000','f','public.qb_family_class'),
  ('20261081100000','f','public.qb_family_assignments'),
  ('20261081100000','c','public.classes.family_workspace_id'),
  ('20261081100000','c','public.assignments.source_type'),
  ('20261082100000','t','public.family_orders'),
  ('20261082100000','t','public.family_order_items'),
  ('20261082100000','f','quizbox_core.family_order_json'),
  ('20261082100000','f','public.qb_family_order_revoke'),
  ('20261082100000','f','public.qb_family_wallets'),
  ('20261083100000','f','public.qb_family_progress'),
  ('20261083100000','f','public.qb_admin_families'),
  ('20261083100000','f','public.qb_admin_family_detail'),
  ('20261084100000','t','public.family_set_grants'),
  ('20261084100000','f','public.qb_family_library'),
  ('20261084100000','f','public.qb_family_my_sets'),
  ('20261084100000','f','public.qb_family_set_record'),
  ('20261085100000','t','public.family_challenge_invites'),
  ('20261085100000','f','public.qb_family_challenges'),
  ('20261085100000','f','public.qb_family_uninvite_challenge'),
  ('20261085100000','f','public.qb_family_my_challenges'),
  ('20261087100000','t','public.parent_profiles')), r as (
  select v, k, o, case k
    when 't' then to_regclass(o) is not null
    when 'x' then to_regprocedure(o) is null
    when 'p' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = split_part(o, '|', 1) and p.prosrc like '%' || split_part(o, '|', 2) || '%')
    when 'r' then case when to_regclass(split_part(o, '|', 1)) is null then false else coalesce((xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || split_part(o, '|', 1) || ' where ' || split_part(o, '|', 2), false, true, '')))[1]::text::int, 0) >= split_part(o, '|', 3)::int end
    when 'f' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = o)
    else exists (select 1 from information_schema.columns where table_schema || '.' || table_name || '.' || column_name = o) end as ok
  from c)
select * from (select v as version, count(*) as checks, count(*) filter (where ok) as found,
  case when bool_and(ok) then 'ok' when not bool_or(ok) then 'MISSING' else 'PARTIAL' end as status,
  coalesce(string_agg(o, ', ') filter (where not ok), '') as missing
from r group by v) x
union all select '20261054100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261058100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261060100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261061100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261062100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261063100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261064100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261065100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261071100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261073100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261086100000', 0::bigint, 0::bigint, 'data-only', ''
union all select '20261117110000', 0::bigint, 0::bigint, 'data-only', ''
order by 1;
