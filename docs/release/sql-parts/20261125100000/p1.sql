-- Admin live figures: qb_admin_live(section, days) serves the Admin dashboard from a stored snapshot that is refreshed when it grows old.
-- Three sections answer on their own, so a slow one never holds back the others: 'people' (users, activity, markets), 'content' (questions by class, batches) and
-- 'queues' (one count for each admin tab). A person only receives the counts their permissions allow. If a refresh fails or takes too long, the last good figures
-- are returned and marked stale. Where pg_cron is installed the snapshot is also refreshed every minute, so nobody waits for the first calculation.
-- Reads business tables only. Writes only its own snapshot table. Additive and safe to run again. qb_admin_dashboard stays as it was.
-- Rollback: supabase/rollback/admin_live_stats.sql.


-- The question counts are read from these small indexes instead of from every question row.
create index if not exists questions_admin_counts_idx on public.questions (grade, canonical_grade_code, source_grade_code, subject_name, validation_status, status);
create index if not exists attempts_started_at_idx on public.attempts (started_at);

create schema if not exists quizbox_stats;
revoke all on schema quizbox_stats from public, anon, authenticated;

create table if not exists quizbox_stats.snapshots (
  section text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  took_ms integer not null default 0
);
alter table quizbox_stats.snapshots enable row level security;
revoke all on quizbox_stats.snapshots from public, anon, authenticated;

-- One count per admin tab. cap says who may see it: a = any staff who can open the dashboard, s = super admin, f = finance, c = content, p = support.
create or replace function quizbox_stats.metrics_content() returns table (key text, cap text, query text)
language sql immutable set search_path = '' as $fn$
  values
  ('markets_active', 'a', $q$select count(*) from public.markets where status = 'ACTIVE'$q$),
  ('markets_setting_up', 'a', $q$select count(*) from public.markets where status = 'CONFIGURING'$q$),
  ('schools_waiting', 's', $q$select count(*) from public.school_directory where status = 'pending'$q$),
  ('schools_listed', 's', $q$select count(*) from public.school_directory where status = 'approved'$q$),
  ('partners_waiting', 's', $q$select count(*) from public.partners where status = 'pending_verification'$q$),
  ('sponsors_waiting', 's', $q$select count(*) from public.sponsor_profiles where upper(coalesce(sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION' and upper(verification_status) = 'PENDING'$q$),
  ('source_issues', 's', $q$select count(*) from public.market_attribution_issues$q$),
  ('source_imports_waiting', 's', $q$select count(*) from quizbox_sources.ingestion_jobs where status = 'CONFIRMED'$q$),
  ('loads_failed_7d', 'c', $q$select count(*) from public.question_load_batches where status = 'FAILED' and created_at >= now() - interval '7 days'$q$),
  ('topics_draft', 'c', $q$select count(*) from public.curriculum_topics where status = 'DRAFT'$q$),
  ('factory_running', 'c', $q$select count(*) from quizbox_factory.campaigns where status = 'RUNNING'$q$),
  ('factory_failed_7d', 'c', $q$select count(*) from quizbox_factory.jobs where status = 'FAILED' and created_at >= now() - interval '7 days'$q$),
  ('question_reports_open', 'a', $q$select count(*) from public.content_reports where status = 'open'$q$),
  ('listings_waiting', 'a', $q$select count(*) from public.mk_items where status = 'submitted'$q$),
  ('sellers_waiting', 'a', $q$select count(*) from public.mk_sellers where status = 'pending'$q$),
  ('challenges_live', 'a', $q$select count(*) from public.challenge_campaigns where status = 'LIVE'$q$),
  ('challenge_reports_open', 'a', $q$select count(*) from public.challenge_reports where status = 'OPEN'$q$),
  ('prizes_waiting', 'a', $q$select count(*) from public.challenge_awards where status = 'PENDING'$q$),
  ('competition_reviews_waiting', 'a', $q$select count(*) from quizbox_competition.candidates where status in ('GENERATED', 'ASSIGNED_FOR_REVIEW', 'UNDER_REVIEW')$q$),
  ('competition_jobs_failed_7d', 'a', $q$select count(*) from quizbox_competition.generation_jobs where status = 'FAILED' and created_at >= now() - interval '7 days'$q$)
$fn$;

create or replace function quizbox_stats.metrics_operations() returns table (key text, cap text, query text)
language sql immutable set search_path = '' as $fn$
  values
  ('reviewer_applications', 'p', $q$select count(*) from public.sme_profiles where reviewer_status = 'pending'$q$),
  ('reviewers_verified', 's', $q$select count(*) from public.sme_profiles where reviewer_status = 'verified'$q$),
  ('sme_reviews_open', 'c', $q$select count(*) from public.sme_review_assignments where review_completed_at is null$q$),
  ('compensation_unresolved', 's', $q$select count(*) from quizbox_competition.review_events where policy_context_snapshot->>'compensation_status' = 'COMPENSATION_UNRESOLVED'$q$),
  ('sme_payouts_waiting', 'f', $q$select count(*) from public.sme_payout_batches where status in ('draft', 'approved')$q$),
  ('seller_payouts_requested', 'f', $q$select count(*) from public.mk_payouts where status = 'requested'$q$),
  ('payments_mismatched', 'f', $q$select count(*) from public.payment_intents where reconciliation_status in ('mismatch', 'manual_review')$q$),
  ('payments_open_old', 'f', $q$select count(*) from public.payment_intents where status in ('initiated', 'pending', 'awaiting_approval', 'processing') and created_at < now() - interval '1 hour' and created_at >= now() - interval '14 days'$q$),
  ('payments_successful_24h', 'f', $q$select count(*) from public.payment_intents where status = 'successful' and created_at >= now() - interval '24 hours'$q$),
  ('refunds_open', 'f', $q$select count(*) from public.refund_cases where status in ('open', 'cash_refund_due')$q$),
  ('affiliates_waiting', 'f', $q$select count(*) from public.affiliates where status = 'applied'$q$),
  ('support_open', 'a', $q$select count(*) from public.support_requests where status = 'open'$q$),
  ('support_waiting_for_user', 'a', $q$select count(*) from public.support_requests where status = 'waiting_for_user'$q$),
  ('support_new_7d', 'a', $q$select count(*) from public.support_requests where created_at >= now() - interval '7 days'$q$),
  ('enquiries_new', 'p', $q$select count(*) from quizbox_private.public_interest_submissions where status = 'NEW'$q$),
  ('client_errors_24h', 'p', $q$select coalesce(sum(coalesce((details->>'count')::integer, 1)), 0) from public.system_events where event_type = 'CLIENT_ERROR' and created_at >= now() - interval '24 hours'$q$),
  ('server_errors_24h', 'a', $q$select count(*) from public.system_events where created_at >= now() - interval '24 hours' and event_type <> 'CLIENT_ERROR' and upper(severity) in ('ERROR', 'CRITICAL')$q$),
  ('notifications_failed', 'a', $q$select count(*) from public.notification_deliveries where upper(status::text) = 'FAILED'$q$),
  ('erasures_due', 's', $q$select count(*) from public.student_profiles where managed_by is not null and is_minor and erased_at is null and archived_at < now() - make_interval(months => public.qb_managed_retention_months())$q$),
  ('family_applications_waiting', 's', $q$select count(*) from public.sponsor_family_applications where status = 'submitted'$q$),
  ('subscriptions_active', 's', $q$select count(*) from public.learner_subscriptions where status = 'active' and valid_until > now()$q$),
  ('staff_members', 's', $q$select count(distinct user_id) from public.user_capabilities where active and capability in ('content_admin', 'sme_support', 'finance_admin')$q$),
  ('help_drafts', 'p', $q$select (select count(*) from public.help_articles where state = 'draft') + (select count(*) from public.help_videos where state = 'draft')$q$),
  ('posts_published', 'p', $q$select count(*) from public.marketing_posts where state = 'published'$q$),
  ('posts_draft', 'p', $q$select count(*) from public.marketing_posts where state = 'draft'$q$),
  ('policy_drafts', 's', $q$select count(*) from public.policy_versions where state = 'draft'$q$),
  ('social_channels', 's', $q$select count(*) from public.social_channels$q$)
$fn$;
