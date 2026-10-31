-- QuizBox database fingerprint, part A. READ-ONLY: it only looks, it changes nothing.
-- Run the same part on BOTH projects (Preview fngdtxayfoiffbcbmcum and Production fmgccmqxfjppqydkhaiu) and compare the 'status' column row by row.
-- ok = every sampled object of that migration exists; PARTIAL = some do; MISSING = none do (the migration was not applied); data-only = it only inserts rows, so look at the notes.
with c(v, k, o) as (values
  ('20261020100000','f','public.qb_managed_learner_erase'),
  ('20261020100000','f','public.qb_managed_erasure_queue'),
  ('20261020100000','f','public.qb_managed_learner_find'),
  ('20261020100000','c','public.student_profiles.erased_at'),
  ('20261021100000','t','public.challenge_campaigns'),
  ('20261021100000','t','public.challenge_questions'),
  ('20261021100000','f','public.qb_challenge_active_user'),
  ('20261021100000','f','public.challenge_update'),
  ('20261021100000','f','public.challenge_my_attempts'),
  ('20261022100000','t','public.challenge_stages'),
  ('20261022100000','t','public.challenge_content_assets'),
  ('20261022100000','f','public.qb_challenge_stage'),
  ('20261022100000','f','public.challenge_finalize'),
  ('20261022100000','f','public.challenge_admin_overview'),
  ('20261022100000','c','public.challenge_campaigns.brand'),
  ('20261022100000','c','public.challenge_campaigns.stage_count'),
  ('20261023100000','t','public.challenge_reports'),
  ('20261023100000','f','public.qb_challenge_notify'),
  ('20261023100000','f','public.challenge_reports_list'),
  ('20261023100000','f','public.challenge_report_resolve'),
  ('20261023100000','c','public.challenge_campaigns.moderation_state'),
  ('20261023100000','c','public.challenge_campaigns.moderation_note'),
  ('20261024100000','f','public.qb_managed_retention_months'),
  ('20261024100000','f','public.qb_managed_set_auto_erase'),
  ('20261024100000','f','public.qb_managed_reassign'),
  ('20261025100000','t','public.push_subscriptions'),
  ('20261025100000','f','public.qb_push_allowed'),
  ('20261025100000','f','public.qb_push_status'),
  ('20261025100000','f','public.qb_push_report'),
  ('20261025100000','c','public.notifications.push_sent_at'),
  ('20261026100000','c','public.notifications.dismissed_at'),
  ('20261027100000','f','public.qb_challenge_in_audience'),
  ('20261027100000','f','public.qb_challenge_stage_rank'),
  ('20261027100000','f','public.challenge_track_share'),
  ('20261027100000','c','public.challenge_campaigns.format'),
  ('20261027100000','c','public.challenge_campaigns.audience_class_id'),
  ('20261028100000','t','public.activity_drafts'),
  ('20261028100000','f','public.qb_draft_allowed'),
  ('20261028100000','f','public.qb_draft_delete'),
  ('20261028100000','f','public.qb_drafts_sweep'),
  ('20261029100000','t','public.challenge_sections'),
  ('20261029100000','t','public.challenge_participants'),
  ('20261029100000','f','public.challenge_sections_set_visible'),
  ('20261029100000','f','public.challenge_material'),
  ('20261029100000','f','public.challenge_library_stats'),
  ('20261029100000','c','public.challenge_campaigns.target_levels'),
  ('20261029100000','c','public.challenge_campaigns.reader_enabled'),
  ('20261030100000','t','public.price_list'),
  ('20261030100000','f','public.qb_price_admin'),
  ('20261030100000','f','public.qb_price_list_admin'),
  ('20261030100000','f','public.qb_price_save'),
  ('20261031100000','c','public.price_list.coins'),
  ('20261031100000','c','public.price_list.days'),
  ('20261032100000','p','qb_payment_intent_create|QB_BELOW_MINIMUM_CHARGE'),
  ('20261033100000','x','public.qb_practice_menu()'),
  ('20261033100000','x','public.qb_start_quick_practice(uuid[],integer)'),
  ('20261034100000','f','public.qb_owner_is_student'),
  ('20261034100000','f','public.qb_trg_student_question'),
  ('20261034100000','f','public.qb_trg_student_prize')), r as (
  select v, k, o, case k
    when 't' then to_regclass(o) is not null
    when 'x' then to_regprocedure(o) is null
    when 'p' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = split_part(o, '|', 1) and p.prosrc like '%' || split_part(o, '|', 2) || '%')
    when 'r' then case when to_regclass(split_part(o, '|', 1)) is null then false else coalesce((xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || split_part(o, '|', 1) || ' where ' || split_part(o, '|', 2), false, true, '')))[1]::text::int, 0) >= split_part(o, '|', 3)::int end
    when 'f' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = o)
    else exists (select 1 from information_schema.columns where table_schema || '.' || table_name || '.' || column_name = o) end as ok
  from c)
select v as version, count(*) as checks, count(*) filter (where ok) as found,
  case when bool_and(ok) then 'ok' when not bool_or(ok) then 'MISSING' else 'PARTIAL' end as status,
  coalesce(string_agg(o, ', ') filter (where not ok), '') as missing
from r group by v
order by 1;
