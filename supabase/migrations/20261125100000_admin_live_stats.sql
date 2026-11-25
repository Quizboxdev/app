-- Admin live figures: qb_admin_live(section, days) serves the Admin dashboard from a stored snapshot that is refreshed when it grows old.
-- Three sections answer on their own, so a slow one never holds back the others: 'people' (users, activity, markets), 'content' (questions by class, batches) and
-- 'queues' (one count for each admin tab). A person only receives the counts their permissions allow. If a refresh fails or takes too long, the last good figures
-- are returned and marked stale. Where pg_cron is installed the snapshot is also refreshed every minute, so nobody waits for the first calculation.
-- Reads business tables only. Writes only its own snapshot table. Additive and safe to run again. qb_admin_dashboard stays as it was.
-- Rollback: supabase/rollback/admin_live_stats.sql.
begin;

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

-- Every count is worked out on its own: a table that is missing on this database gives null for that count only.
create or replace function quizbox_stats.compute_queues() returns jsonb
language plpgsql set search_path = '' as $fn$
declare m record; n bigint; res jsonb := '{}'::jsonb;
begin
  for m in select * from quizbox_stats.metrics_content() union all select * from quizbox_stats.metrics_operations() loop
    begin
      execute m.query into n;
      res := res || jsonb_build_object(m.key, jsonb_build_object('n', n, 'cap', m.cap));
    exception when others then
      res := res || jsonb_build_object(m.key, jsonb_build_object('n', null, 'cap', m.cap));
    end;
  end loop;
  return res;
end $fn$;

-- All question figures from one pass over the small index (the earlier version read every question row three times), by class and by subject within each class.
-- The class is the market class code. SHS questions leave the older national grade column empty (it has no "SHS 1" label), so grouping on that column alone
-- showed all SHS years as one bar with no name. "SHS 1" is read as SHS1, and the older code B10 is the same year.
create or replace function quizbox_stats.compute_content() returns jsonb
language plpgsql set search_path = '' as $fn$
declare s jsonb; b integer;
begin
  begin
    select jsonb_build_object(
      'live', coalesce(sum(c.live), 0), 'in_review', coalesce(sum(c.rev), 0),
      'by_class', coalesce(jsonb_agg(jsonb_build_object('grade', c.grade, 'live', c.live, 'in_review', c.rev, 'subjects', c.subjects) order by c.grade), '[]'::jsonb)) into s
      from (select x.grade, sum(x.live)::integer as live, sum(x.rev)::integer as rev,
                   jsonb_agg(jsonb_build_object('subject', x.subject, 'live', x.live, 'in_review', x.rev) order by x.live + x.rev desc, x.subject) as subjects
              from (select coalesce(case k.code when 'B10' then 'SHS1' else k.code end, 'Not set') as grade, coalesce(max(q.subject_name), 'Not set') as subject,
                           count(*) filter (where q.status::text = 'active' and q.validation_status = 'approved')::integer as live,
                           count(*) filter (where q.validation_status = 'review' and q.status::text <> 'archived')::integer as rev
                      from public.questions q
                     cross join lateral (select upper(replace(coalesce(nullif(q.canonical_grade_code, ''), nullif(q.source_grade_code, ''), q.grade::text), ' ', '')) as code) k
                     group by 1, lower(q.subject_name)) x
             where x.live > 0 or x.rev > 0
             group by x.grade) c;
  exception when others then return jsonb_build_object('content', null);
  end;
  begin
    select count(*) into b from public.question_load_batches l where l.status in ('LOADED', 'PARTIAL')
      and not exists (select 1 from public.question_batch_approvals a where a.batch_id = l.id and a.status = 'ACTIVE');
  exception when others then b := null;
  end;
  return jsonb_build_object('content', s || jsonb_build_object('batches_waiting', b));
end $fn$;

create or replace function quizbox_stats.compute_people(p_days integer) returns jsonb
language plpgsql set search_path = '' as $fn$
declare d0 date := (now())::date - (p_days - 1); res jsonb := '{}'::jsonb; s jsonb;
begin
  begin  -- users
    select jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'new_prev_7d', (select count(*) from public.profiles where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
      'by_role', coalesce((select jsonb_object_agg(r.role, r.c) from (select role::text as role, count(*)::integer as c from public.profiles group by role) r), '{}'::jsonb),
      'signups', coalesce((select jsonb_agg(jsonb_build_object('week', g.d::date, 'added', coalesce(x.c, 0)) order by g.d)
                             from generate_series(d0, (now())::date, interval '1 day') as g(d)
                             left join (select created_at::date as day, count(*)::integer as c from public.profiles where created_at >= d0 group by 1) x on x.day = g.d::date), '[]'::jsonb)) into s;
    res := res || jsonb_build_object('users', s);
  exception when others then res := res || jsonb_build_object('users', null);
  end;
  begin  -- learning activity
    select jsonb_build_object(
      'attempts_7d', (select count(*) from public.attempts where started_at >= now() - interval '7 days'),
      'attempts_prev_7d', (select count(*) from public.attempts where started_at >= now() - interval '14 days' and started_at < now() - interval '7 days'),
      'attempts_total', (select count(*) from public.attempts),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('week', g.d::date, 'started', coalesce(a.c, 0), 'submitted', coalesce(b.c, 0)) order by g.d)
                           from generate_series(d0, (now())::date, interval '1 day') as g(d)
                           left join (select started_at::date as day, count(*)::integer as c from public.attempts where started_at >= d0 group by 1) a on a.day = g.d::date
                           left join (select submitted_at::date as day, count(*)::integer as c from public.attempts where submitted_at >= d0 group by 1) b on b.day = g.d::date), '[]'::jsonb)) into s;
    res := res || jsonb_build_object('learning', s);
  exception when others then res := res || jsonb_build_object('learning', null);
  end;
  begin  -- markets by stage
    select coalesce(jsonb_object_agg(m.st, m.c), '{}'::jsonb) into s from (select status::text as st, count(*)::integer as c from public.markets group by status) m;
    res := res || jsonb_build_object('markets', s);
  exception when others then res := res || jsonb_build_object('markets', null);
  end;
  return res;
end $fn$;

-- Calculates one snapshot and stores it. The key is 'queues', 'content' or 'people:<days>'.
create or replace function quizbox_stats.refresh(p_key text) returns void
language plpgsql set search_path = '' as $fn$
declare t0 timestamptz := clock_timestamp(); v jsonb;
begin
  v := case split_part(p_key, ':', 1)
         when 'queues' then quizbox_stats.compute_queues()
         when 'content' then quizbox_stats.compute_content()
         when 'people' then quizbox_stats.compute_people(split_part(p_key, ':', 2)::integer)
       end;
  insert into quizbox_stats.snapshots as s (section, payload, computed_at, took_ms)
  values (p_key, v, clock_timestamp(), (extract(epoch from clock_timestamp() - t0) * 1000)::integer)
  on conflict (section) do update set payload = excluded.payload, computed_at = excluded.computed_at, took_ms = excluded.took_ms;
end $fn$;

-- For the scheduler: refreshes what the dashboard shows by default. One failure does not stop the rest.
create or replace function quizbox_stats.refresh_all() returns void
language plpgsql set search_path = '' as $fn$
declare k text;
begin
  foreach k in array array['queues', 'content', 'people:30'] loop
    begin
      if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || k)) then perform quizbox_stats.refresh(k); end if;
    exception when others then raise warning 'qb_admin_live refresh of % failed: %', k, sqlerrm;
    end;
  end loop;
end $fn$;

revoke all on all functions in schema quizbox_stats from public, anon, authenticated;

create or replace function public.qb_admin_live(p_section text, p_days integer default 30, p_max_age integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_key text; ttl integer; snap quizbox_stats.snapshots; data jsonb; failed boolean := false;
  is_super boolean; caps text[] := array['a'];
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_section is null or p_section not in ('people', 'content', 'queues') then raise exception 'QB_INVALID_ACTION' using errcode = '22023'; end if;
  v_key := case when p_section = 'people' then 'people:' || days else p_section end;
  -- How old a snapshot may be before it is calculated again. A refresh button may ask for newer figures, but not newer than 5 seconds.
  ttl := case p_section when 'queues' then 20 when 'people' then 60 else 90 end;
  if p_max_age is not null then ttl := least(ttl, greatest(p_max_age, 5)); end if;

  select * into snap from quizbox_stats.snapshots s where s.section = v_key;
  if snap.section is null or snap.computed_at <= clock_timestamp() - make_interval(secs => ttl) then
    -- Only one caller calculates at a time. The others take the last good figures; with nothing stored yet they wait for the first calculation.
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || v_key)) then
      begin
        perform quizbox_stats.refresh(v_key);
      exception when query_canceled or others then
        if snap.section is null then raise; end if;
        failed := true;
      end;
    elsif snap.section is null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || v_key));
      if not exists (select 1 from quizbox_stats.snapshots s where s.section = v_key) then perform quizbox_stats.refresh(v_key); end if;
    end if;
    select * into snap from quizbox_stats.snapshots s where s.section = v_key;
  end if;

  if p_section = 'queues' then
    is_super := quizbox_market.is_super();
    if is_super then caps := caps || 's'::text; end if;
    if is_super or quizbox_sme.has_capability('finance_admin') then caps := caps || 'f'::text; end if;
    if is_super or quizbox_sme.has_capability('content_admin') then caps := caps || 'c'::text; end if;
    if is_super or quizbox_sme.has_capability('sme_support') then caps := caps || 'p'::text; end if;
    data := coalesce((select jsonb_object_agg(e.key, e.value->'n') from jsonb_each(snap.payload) e where e.value->>'cap' = any (caps)), '{}'::jsonb);
  else
    data := snap.payload;
  end if;

  return jsonb_build_object('section', p_section, 'data', data, 'computed_at', snap.computed_at,
    'age_seconds', greatest(0, floor(extract(epoch from clock_timestamp() - snap.computed_at)))::integer,
    'stale', failed or snap.computed_at <= clock_timestamp() - make_interval(secs => ttl));
end $fn$;

revoke all on function public.qb_admin_live(text, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_admin_live(text, integer, integer) to authenticated;

-- Optional scheduler: where pg_cron is installed, keep the snapshot warm. Without it the figures are calculated when someone asks.
do $do$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('qb-admin-live-refresh', '* * * * *', 'select quizbox_stats.refresh_all()');
  end if;
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $do$;

commit;
notify pgrst, 'reload schema';
