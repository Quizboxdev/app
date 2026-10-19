-- Rollback for 20261019150000_managed_learners: managed learners lose their restrictions only through this rollback of qb_feature_allowed; accounts and data stay.
begin;
create or replace function public.qb_feature_allowed(p_feature text) returns boolean language sql stable security definer set search_path='' as $fn$
 select not (coalesce((select status from public.learner_consent where user_id=auth.uid()),'not_required') in ('pending','withdrawn')
  and quizbox_core.setting('safety.consent_pending_blocked_features') ? p_feature);
$fn$;
drop function if exists public.qb_consume_budget(text, integer, integer);
drop function if exists public.qb_managed_learner_archive(uuid);
drop function if exists public.qb_managed_learner_authorise(uuid, uuid);
drop function if exists public.qb_managed_learner_list(uuid);
drop function if exists public.qb_managed_learner_provision(uuid, uuid, uuid, text, text, text);
drop function if exists public.qb_managed_class_context(uuid);
delete from public.platform_settings where key = 'safety.managed_minor_blocked_features' and scope_type = 'global';
commit;
