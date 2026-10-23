-- Seat bundles for challenges and competitions (the approved Coin plan, phase 2).
-- A quiz is free for up to 5 players. To host more, the organiser buys a bundle: 1 Coin per player (up to 1000), paid from their wallet. They can upgrade later by paying the difference.
-- When a quiz is full, new players are told so; people already in keep their place until the quiz ends. Players of a paid quiz do not use their own free sessions.
-- Quizzes aimed at one class or one school stay free. The payer gets full access to QuizBox for the quiz period (at most 90 days).
-- All of it is OFF until the owner switches on the existing flag flags.paid_challenges; quizzes made before that have no cap. Settings: flags.paid_challenges (true/false), challenges.free_seats (default 5).
-- The functions challenge_join, challenge_start and qb_free_sessions_used are replaced with the current versions plus the changes above (nothing else in them changes).
-- Additive and idempotent. Rollback: supabase/rollback/challenge_seats.sql (restores the three functions as they were).
begin;

alter table public.challenge_campaigns add column if not exists seat_cap integer check (seat_cap is null or seat_cap between 1 and 1000);
alter table public.challenge_campaigns add column if not exists seats_paid integer not null default 0 check (seats_paid between 0 and 1000);
alter table public.challenge_campaigns add column if not exists seats_paid_at timestamptz;
alter table public.challenge_campaigns add column if not exists seats_paid_by uuid references public.profiles(id) on delete set null;

insert into public.platform_settings(key, value, description)
select 'challenges.free_seats', '5'::jsonb, 'Players a quiz can have without paying for seats' where not exists (select 1 from public.platform_settings where key = 'challenges.free_seats' and scope_type = 'global');
insert into public.platform_settings(key, value, description)
select 'flags.paid_challenges', 'false'::jsonb, 'Paid competitions/challenges' where not exists (select 1 from public.platform_settings where key = 'flags.paid_challenges' and scope_type = 'global');

-- A new quiz starts with the free number of seats once paid challenges are on (older quizzes keep no cap).
create or replace function public.qb_trg_challenge_seats() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.seat_cap is null and quizbox_core.flag('flags.paid_challenges') then
    new.seat_cap := coalesce(nullif(quizbox_core.setting('challenges.free_seats') #>> '{}', '')::integer, 5);
  end if;
  return new;
end $fn$;
drop trigger if exists qb_challenge_seats on public.challenge_campaigns;
create trigger qb_challenge_seats before insert on public.challenge_campaigns for each row execute function public.qb_trg_challenge_seats();
revoke all on function public.qb_trg_challenge_seats() from public, anon, authenticated;

-- Is this quiz full for a new player? Only when paid challenges are on, a cap applies, and the quiz is not for one class or one school.
create or replace function public.qb_challenge_full(c public.challenge_campaigns) returns boolean language sql stable security definer set search_path = '' as $fn$
  select quizbox_core.flag('flags.paid_challenges') and c.seat_cap is not null and c.audience_class_id is null and c.audience_institution_id is null
     and (select count(*) from public.challenge_participants p where p.campaign_id = c.id) >= c.seat_cap;
$fn$;
revoke all on function public.qb_challenge_full(public.challenge_campaigns) from public, anon, authenticated;

-- What a visitor or player may know: whether the quiz has a limit and whether it is full.
create or replace function public.qb_challenge_seat_status(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; n integer; capped boolean;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(coalesce(p_slug, ''))) and status in ('LIVE', 'PAUSED', 'COMPLETED') and visibility <> 'PRIVATE';
  if c.id is null then return null; end if;
  select count(*) into n from public.challenge_participants where campaign_id = c.id;
  capped := quizbox_core.flag('flags.paid_challenges') and c.seat_cap is not null and c.audience_class_id is null and c.audience_institution_id is null;
  return jsonb_build_object('capped', capped, 'cap', case when capped then c.seat_cap end, 'joined', n, 'full', capped and n >= c.seat_cap);
end $fn$;

-- The organiser's view of their quiz's seats.
create or replace function public.qb_challenge_seats_info(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object('enabled', quizbox_core.flag('flags.paid_challenges'), 'free_seats', coalesce(nullif(quizbox_core.setting('challenges.free_seats') #>> '{}', '')::integer, 5),
    'seat_cap', c.seat_cap, 'seats_paid', c.seats_paid, 'joined', (select count(*) from public.challenge_participants p where p.campaign_id = c.id),
    'class_targeted', c.audience_class_id is not null or c.audience_institution_id is not null, 'ends_at', c.ends_at);
end $fn$;

-- Buy (or upgrade to) a bundle: the cost is the new total minus what was already paid, in Coins from the organiser's wallet. Safe to repeat: the same purchase is never charged twice.
create or replace function public.qb_challenge_seats_buy(p_campaign uuid, p_seats integer) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; v_cost integer; v_until timestamptz;
begin
  c := public.qb_challenge_owned(p_campaign);
  if not quizbox_core.flag('flags.paid_challenges') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if c.audience_class_id is not null or c.audience_institution_id is not null then raise exception 'QB_SEATS_NOT_NEEDED' using errcode = '55000'; end if;
  if p_seats is null or p_seats < 6 or p_seats > 1000 or p_seats < c.seats_paid then raise exception 'QB_INVALID_SEATS' using errcode = '22023'; end if;
  if p_seats = c.seats_paid then return jsonb_build_object('ok', true, 'already', true, 'seat_cap', c.seat_cap); end if;
  v_cost := p_seats - c.seats_paid;
  perform public.qb_coin_spend(auth.uid(), v_cost, 'challenge_seats', c.id::text, 'seats-' || c.id::text || '-' || c.seats_paid::text || '-' || p_seats::text);
  update public.challenge_campaigns set seat_cap = p_seats, seats_paid = p_seats, seats_paid_at = coalesce(seats_paid_at, now()), seats_paid_by = coalesce(seats_paid_by, auth.uid()), updated_at = now() where id = c.id;
  v_until := least(coalesce(c.ends_at, now() + interval '90 days'), now() + interval '90 days');
  if v_until > now() and not exists (select 1 from public.learner_subscriptions s where s.source = 'payment' and s.source_ref = 'seats:' || c.id::text) then
    insert into public.learner_subscriptions(user_id, plan, status, valid_until, source, source_ref, note) values (auth.uid(), 'seats_access', 'active', v_until, 'payment', 'seats:' || c.id::text, 'Seat bundle for a quiz (full access for the quiz period, at most 90 days)');
  end if;
  perform public.qb_challenge_audit('challenge_seats_bought', c.id, jsonb_build_object('seats', p_seats, 'coins', v_cost));
  return jsonb_build_object('ok', true, 'already', false, 'seat_cap', p_seats, 'coins', v_cost);
end $fn$;

create or replace function public.challenge_join(p_slug text, p_code text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status <> 'LIVE' or c.moderation_state <> 'OK' or (c.ends_at is not null and c.ends_at <= now()) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  if exists (select 1 from public.challenge_participants where campaign_id = c.id and user_id = auth.uid()) then return jsonb_build_object('ok', true, 'already', true); end if;
  if c.owner_id <> auth.uid() and public.qb_challenge_full(c) then raise exception 'QUIZ_FULL' using errcode = '55000'; end if;
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())
     and c.seats_paid_at is null and public.qb_challenge_allowance_blocked(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_participants where user_id = auth.uid() and joined_at > now() - interval '1 hour') >= 60 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.challenge_participants(campaign_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true, 'already', false);
end $fn$;

create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1); v_clear text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  if c.owner_id <> auth.uid() and not exists (select 1 from public.challenge_participants p where p.campaign_id = c.id and p.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts x where x.campaign_id = c.id and x.user_id = auth.uid()) and public.qb_challenge_full(c) then raise exception 'QUIZ_FULL' using errcode = '55000'; end if;
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_participants p where p.campaign_id = c.id and p.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())
     and c.seats_paid_at is null and public.qb_challenge_allowance_blocked(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED' using errcode = '55000'; end if;
  select * into d from public.qb_challenge_stage(c.id, v_stage);
  if d.starts_at is not null and d.starts_at > now() then raise exception 'STAGE_NOT_OPEN' using errcode = '55000'; end if;
  if d.ends_at is not null and d.ends_at <= now() then raise exception 'STAGE_CLOSED' using errcode = '55000'; end if;
  if v_stage > 1 then
    v_clear := public.qb_challenge_cleared(c.id, v_stage - 1, auth.uid());
    if v_clear = 'WAITING' then raise exception 'ROUND_STILL_RUNNING' using errcode = '55000';
    elsif v_clear = 'OUT' then raise exception 'NOT_THROUGH' using errcode = '55000';
    elsif v_clear <> 'YES' then raise exception 'STAGE_LOCKED' using errcode = '55000'; end if;
  end if;
  select count(*) into made from public.challenge_attempts where campaign_id = c.id and user_id = auth.uid() and stage_no = v_stage;
  if made >= c.max_attempts then raise exception 'NO_ATTEMPTS_LEFT' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_attempts where user_id = auth.uid() and started_at > now() - interval '1 hour') >= 30 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  select array_agg(id) into ids from (select id from public.challenge_questions where campaign_id = c.id and stage_no = v_stage order by random() limit d.question_count) s;
  if ids is null or cardinality(ids) < d.question_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  insert into public.challenge_participants(campaign_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  v_exp := now() + make_interval(secs => d.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, stage_no, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), v_stage, made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', d.time_limit_seconds, 'title', c.title, 'stage_no', v_stage, 'stage_title', d.title, 'stage_count', c.stage_count,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;

create or replace function public.qb_free_sessions_used(p_user uuid) returns integer language sql stable security definer set search_path = '' as $fn$
  select ((select count(*) from public.assessments a where a.owner_user_id = p_user and a.reference_type = 'SELF_PRACTICE')
        + (select count(distinct x.campaign_id) from (select campaign_id from public.challenge_participants where user_id = p_user union select campaign_id from public.challenge_attempts where user_id = p_user) x
             join public.challenge_campaigns c on c.id = x.campaign_id where c.owner_id <> p_user and c.seats_paid_at is null))::integer;
$fn$;

revoke all on function public.qb_challenge_seat_status(text), public.qb_challenge_seats_info(uuid), public.qb_challenge_seats_buy(uuid, integer) from public, anon, authenticated;
grant execute on function public.qb_challenge_seat_status(text) to anon, authenticated, service_role;
grant execute on function public.qb_challenge_seats_info(uuid), public.qb_challenge_seats_buy(uuid, integer) to authenticated;

commit;
notify pgrst, 'reload schema';
