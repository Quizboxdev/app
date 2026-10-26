-- QuizBox database fingerprint, part B. READ-ONLY: it only looks, it changes nothing.
-- Run the same part on BOTH projects (Preview fngdtxayfoiffbcbmcum and Production fmgccmqxfjppqydkhaiu) and compare the 'status' column row by row.
-- ok = every sampled object of that migration exists; PARTIAL = some do; MISSING = none do (the migration was not applied); data-only = it only inserts rows, so look at the notes.
with c(v, k, o) as (values
  ('20261035100000','t','public.refund_cases'),
  ('20261035100000','f','public.qb_admin_payment_facts'),
  ('20261035100000','f','public.qb_admin_refund_case_save'),
  ('20261035100000','f','public.qb_admin_refund_cases'),
  ('20261036100000','t','public.company_details'),
  ('20261036100000','t','public.policy_documents'),
  ('20261036100000','f','public.qb_trg_policy_version_guard'),
  ('20261036100000','f','public.qb_policy_publish'),
  ('20261036100000','f','public.qb_policy_record_for_managed'),
  ('20261037100000','r','public.policy_versions|true|4'),
  ('20261038100000','t','public.support_requests'),
  ('20261038100000','t','public.support_request_messages'),
  ('20261038100000','f','public.qb_support_is_staff'),
  ('20261038100000','f','public.qb_support_admin_list'),
  ('20261038100000','f','public.qb_support_file_add'),
  ('20261039100000','t','public.help_articles'),
  ('20261039100000','f','public.qb_help_list'),
  ('20261039100000','f','public.qb_help_admin_list'),
  ('20261039100000','f','public.qb_help_delete'),
  ('20261040100000','r','public.help_articles|slug in (''getting-started-learner'',''getting-started-teacher'',''getting-started-school'',''practice-session'',''join-a-class'',''create-a-class'',''add-young-learners'',''create-an-assignment'',''do-an-assignment'',''join-challenge-or-competition'',''create-a-challenge'',''create-a-competition'',''share-challenge-or-competition'',''read-the-material'',''unfinished-work'',''subscribe-and-coins'',''ask-for-a-refund'',''reset-password'',''results-and-progress'',''notifications'',''contact-support'',''sponsor-a-challenge'',''staying-safe-and-private'')|23'),
  ('20261041100000','f','public.qb_trg_challenge_seats'),
  ('20261041100000','f','public.qb_challenge_seat_status'),
  ('20261041100000','f','public.qb_challenge_seats_buy'),
  ('20261041100000','c','public.challenge_campaigns.seat_cap'),
  ('20261041100000','c','public.challenge_campaigns.seats_paid'),
  ('20261042100000','r','public.help_articles|slug in (''add-more-players'')|1'),
  ('20261043100000','t','public.mk_sellers'),
  ('20261043100000','t','public.mk_items'),
  ('20261043100000','f','public.qb_mk_num'),
  ('20261043100000','f','public.qb_mk_payout_cancel'),
  ('20261043100000','f','public.qb_mk_enabled'),
  ('20261044100000','r','public.help_articles|slug in (''sell-question-sets'',''buy-a-question-set'')|2'),
  ('20261045100000','f','public.qb_export_ts'),
  ('20261045100000','f','public.qb_export_build_b'),
  ('20261045100000','f','public.qb_export_run'),
  ('20261046100000','f','public.qb_export_defs_a'),
  ('20261046100000','f','public.qb_export_build_f'),
  ('20261046100000','f','public.qb_export_build_h'),
  ('20261047100000','p','qb_operation_failure|ATTEMPT_SAVE'),
  ('20261048100000','t','public.commission_policies'),
  ('20261048100000','t','public.affiliates'),
  ('20261048100000','f','public.qb_cm_guard'),
  ('20261048100000','f','public.qb_referral_capture'),
  ('20261048100000','f','public.qb_commission_admin_reverse'),
  ('20261049100000','t','public.partners'),
  ('20261049100000','t','public.partner_identity_configs'),
  ('20261049100000','f','public.qb_pg_is_staff'),
  ('20261049100000','f','public.qb_admin_partner_contract_amend'),
  ('20261049100000','f','public.qb_partner_contracts_expire')), r as (
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
