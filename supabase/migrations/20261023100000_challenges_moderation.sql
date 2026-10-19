-- QuizBox Challenges, moderation and notifications. Anyone signed in can report a public challenge; three different reporters hide it for review; an admin dismisses, takes it down or restores it.
-- Winners are told in the app when prizes are worked out and when delivery is updated; the organiser is told when a challenge is hidden or taken down.
-- Builds on 20261021100000 and 20261022100000. Additive and idempotent; rollback: supabase/rollback/challenges_moderation.sql (re-apply the earlier two migrations afterwards).
--   moderation_state: OK | UNDER_REVIEW | TAKEN_DOWN (a challenge that is not OK is not live, not listed and cannot be published)
--   challenge_report / challenge_reports_list / challenge_report_resolve, qb_challenge_notify (internal; never blocks the action that calls it)

alter table public.challenge_campaigns
  add column if not exists moderation_state text not null default 'OK' check (moderation_state in ('OK','UNDER_REVIEW','TAKEN_DOWN')),
  add column if not exists moderation_note text check (moderation_note is null or length(moderation_note) <= 400);

create table if not exists public.challenge_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  reason text not null check (reason in ('inappropriate','misleading','copyright','spam','wrong_answers','other')),
  details text check (details is null or length(details) <= 500),
  status text not null default 'OPEN' check (status in ('OPEN','DISMISSED','ACTIONED')),
  handled_by uuid references public.profiles(id), handled_note text check (handled_note is null or length(handled_note) <= 400),
  created_at timestamptz not null default now(), handled_at timestamptz,
  unique (campaign_id, reporter_id)
);
create index if not exists challenge_reports_open on public.challenge_reports(status, campaign_id);
alter table public.challenge_reports enable row level security;
revoke all on public.challenge_reports from anon, authenticated, public;

create or replace function public.qb_challenge_live(c public.challenge_campaigns) returns boolean language sql stable set search_path = '' as $fn$
  select c.status = 'LIVE' and c.moderation_state = 'OK' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now());
$fn$;

create or replace function public.qb_challenge_notify(p_user uuid, p_title text, p_message text, p_link text, p_category text default 'system') returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if to_regclass('public.notifications') is null then return; end if;
  execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
    using 'challenge', left(p_title, 140), left(p_message, 400), p_link, p_category, p_user;
exception when others then null;     -- a notification problem must never block the action that caused it
end $fn$;
revoke all on function public.qb_challenge_notify(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.challenge_report(p_slug text, p_reason text, p_details text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; n integer;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug)) and status in ('LIVE','PAUSED','COMPLETED') and visibility <> 'PRIVATE';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if c.owner_id = auth.uid() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if (select count(*) from public.challenge_reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.challenge_reports(campaign_id, reporter_id, reason, details) values (c.id, auth.uid(), p_reason, nullif(btrim(p_details), ''))
    on conflict (campaign_id, reporter_id) do nothing;
  select count(distinct reporter_id) into n from public.challenge_reports where campaign_id = c.id and status = 'OPEN';
  if n >= 3 and c.moderation_state = 'OK' then
    update public.challenge_campaigns set moderation_state = 'UNDER_REVIEW', moderation_note = 'Hidden while reports are reviewed', updated_at = now() where id = c.id;
    perform public.qb_challenge_notify(c.owner_id, 'Your challenge is hidden for review', c.title || ' has been reported by several people and is hidden until an administrator reviews it.', '/creator/' || c.id, 'system');
    perform public.qb_challenge_audit('challenge_auto_hidden', c.id, jsonb_build_object('reports', n));
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_reports_list(p_status text default 'OPEN') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select r.id, r.reason, r.details, r.status, r.created_at, r.handled_note, c.id as campaign_id, c.slug, c.title, c.status as campaign_status, c.moderation_state,
           (select p.full_name from public.profiles p where p.id = c.owner_id) as owner_name,
           (select count(*) from public.challenge_reports x where x.campaign_id = c.id and x.status = 'OPEN') as open_reports
      from public.challenge_reports r join public.challenge_campaigns c on c.id = r.campaign_id
     where r.status = coalesce(p_status, 'OPEN') order by r.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_report_resolve(p_report uuid, p_action text, p_note text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.challenge_reports; c public.challenge_campaigns;
begin
  if not public.qb_challenge_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into r from public.challenge_reports where id = p_report;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into c from public.challenge_campaigns where id = r.campaign_id;
  if p_action = 'DISMISS' then
    update public.challenge_reports set status = 'DISMISSED', handled_by = auth.uid(), handled_note = nullif(btrim(p_note), ''), handled_at = now() where campaign_id = c.id and status = 'OPEN';
    if c.moderation_state = 'UNDER_REVIEW' then update public.challenge_campaigns set moderation_state = 'OK', moderation_note = null, updated_at = now() where id = c.id; end if;
  elsif p_action = 'TAKE_DOWN' then
    update public.challenge_reports set status = 'ACTIONED', handled_by = auth.uid(), handled_note = nullif(btrim(p_note), ''), handled_at = now() where campaign_id = c.id and status = 'OPEN';
    update public.challenge_campaigns set moderation_state = 'TAKEN_DOWN', moderation_note = coalesce(nullif(btrim(p_note), ''), 'Removed after review'), updated_at = now() where id = c.id;
    perform public.qb_challenge_notify(c.owner_id, 'Your challenge was taken down', c.title || ' was removed after a review. ' || coalesce(nullif(btrim(p_note), ''), ''), '/creator/' || c.id, 'system');
  elsif p_action = 'RESTORE' then
    update public.challenge_campaigns set moderation_state = 'OK', moderation_note = null, updated_at = now() where id = c.id;
    perform public.qb_challenge_notify(c.owner_id, 'Your challenge is back', c.title || ' has been restored.', '/creator/' || c.id, 'system');
  else raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  perform public.qb_challenge_audit('challenge_moderation_' || lower(p_action), c.id, jsonb_build_object('report', p_report));
  return jsonb_build_object('ok', true);
end $fn$;

-- Re-declared below with the moderation checks and the notifications added.
create or replace function public.challenge_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; g integer; need integer; have integer; ungrounded integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if c.moderation_state <> 'OK' then raise exception 'TAKEN_DOWN' using errcode = '55000'; end if;
  for g in select generate_series(1, c.stage_count) loop
    select d.question_count into need from public.qb_challenge_stage(p_id, g) d;
    select count(*) into have from public.challenge_questions where campaign_id = p_id and stage_no = g;
    if have < need then raise exception 'NOT_ENOUGH_QUESTIONS' using errcode = '55000'; end if;
  end loop;
  if c.category = 'book' then
    select count(*) into ungrounded from public.challenge_questions where campaign_id = p_id and (source_chunk_id is null or source_quote is null);
    if ungrounded > 0 then raise exception 'NOT_GROUNDED' using errcode = '55000'; end if;
  end if;
  if c.ends_at is not null and c.ends_at <= now() then raise exception 'ENDS_IN_THE_PAST' using errcode = '22023'; end if;
  update public.challenge_campaigns set status = 'LIVE', published_at = coalesce(published_at, now()), updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, 'campaign_published'); perform public.qb_challenge_audit('challenge_published', p_id);
  return jsonb_build_object('ok', true, 'slug', c.slug);
end $fn$;

create or replace function public.challenge_finalize(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; made integer := 0; r record;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'COMPLETED' then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if c.finalized_at is not null then return jsonb_build_object('ok', true, 'already_finalized', true); end if;
  for r in select k.user_id, k.rank, pz.id as prize_id from public.qb_challenge_ranking(p_id) k join public.challenge_prizes pz on pz.campaign_id = p_id and k.rank between pz.rank_from and pz.rank_to loop
    insert into public.challenge_awards(campaign_id, prize_id, user_id, rank) values (p_id, r.prize_id, r.user_id, r.rank) on conflict do nothing;
    made := made + 1;
    perform public.qb_challenge_notify(r.user_id, 'You won a prize', 'You ranked ' || r.rank || ' in ' || c.title || '. The organiser will contact you to arrange delivery.', '/play', 'reward');
  end loop;
  update public.challenge_campaigns set finalized_at = now(), updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, 'campaign_finalized'); perform public.qb_challenge_audit('challenge_finalized', p_id, jsonb_build_object('awards', made));
  return jsonb_build_object('ok', true, 'awards', made);
end $fn$;

create or replace function public.challenge_award_update(p_award uuid, p_status text, p_note text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.challenge_awards;
begin
  select * into a from public.challenge_awards where id = p_award;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_challenge_owned(a.campaign_id);
  if p_status not in ('PENDING','CONTACTED','FULFILLED','FORFEITED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  update public.challenge_awards set status = p_status, fulfilment_note = nullif(btrim(p_note), ''), updated_at = now(), fulfilled_at = case when p_status = 'FULFILLED' then now() else null end where id = p_award;
  if p_status in ('CONTACTED','FULFILLED') then perform public.qb_challenge_notify(a.user_id, case p_status when 'FULFILLED' then 'Your prize has been delivered' else 'The organiser has contacted you about your prize' end, 'Open My challenges to see the details of your prize.', '/play', 'reward'); end if;
  perform public.qb_challenge_audit('challenge_award_' || lower(p_status), a.campaign_id, jsonb_build_object('award', p_award));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_public_get(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then return null; end if;
  if c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then
    return jsonb_build_object('slug', c.slug, 'title', c.title, 'private', true, 'live', public.qb_challenge_live(c), 'brand', c.brand);
  end if;
  if c.status not in ('LIVE','PAUSED','COMPLETED') and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title, 'summary', c.summary, 'category', c.category, 'visibility', c.visibility, 'status', c.status,
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text, 'brand', c.brand, 'stage_count', c.stage_count,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_no', s.stage_no, 'title', s.title, 'question_count', s.question_count, 'time_limit_seconds', s.time_limit_seconds, 'pass_percent', s.pass_percent) order by s.stage_no)
                          from public.challenge_stages s where s.campaign_id = c.id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('rank_from', p.rank_from, 'rank_to', p.rank_to, 'kind', p.kind, 'title', p.title, 'details', p.details) order by p.rank_from)
                          from public.challenge_prizes p where p.campaign_id = c.id), '[]'::jsonb),
    'finalized', c.finalized_at is not null,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;

create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') or (c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin())) then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select r.rank, r.score, r.max_score, r.duration_ms, r.stages_done,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (r.user_id = auth.uid()) as is_me
      from public.qb_challenge_ranking(c.id) r join public.profiles p on p.id = r.user_id
     order by r.rank limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

revoke all on function public.challenge_report(text, text, text), public.challenge_reports_list(text), public.challenge_report_resolve(uuid, text, text) from public, anon, authenticated;
grant execute on function public.challenge_report(text, text, text), public.challenge_reports_list(text), public.challenge_report_resolve(uuid, text, text) to authenticated;
revoke all on function public.challenge_publish(uuid), public.challenge_finalize(uuid), public.challenge_award_update(uuid, text, text) from public, anon, authenticated;
grant execute on function public.challenge_publish(uuid), public.challenge_finalize(uuid), public.challenge_award_update(uuid, text, text) to authenticated;
revoke all on function public.challenge_public_get(text), public.challenge_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
