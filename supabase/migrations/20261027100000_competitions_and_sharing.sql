-- QuizBox Competitions, sharing and the free-allowance rule for joining.
-- A Challenge is one timed round (speed and understanding). A Competition has rounds; each round can pass people on by a pass mark and/or "top N go through".
-- Both use the same engine (challenge_campaigns) and are told apart by campaigns.format. Anyone signed in (learners included, never managed under-13 learners)
-- may create one and share the link; a teacher or school administrator may also aim one at a class or a whole school. Joining needs an account, and a learner's
-- first join of a challenge or competition uses one session of the free allowance (the same allowance as practice), after which the app sends them to Subscribe.
-- Builds on 20261021100000, 20261022100000, 20261023100000 and 20261018100000. Additive and idempotent. Rollback: supabase/rollback/competitions_and_sharing.sql.
begin;

-- 1. Columns.
alter table public.challenge_campaigns
  add column if not exists format text not null default 'CHALLENGE' check (format in ('CHALLENGE','COMPETITION')),
  add column if not exists audience_class_id uuid references public.classes(id) on delete set null,
  add column if not exists audience_institution_id uuid references public.institutions(id) on delete set null;
alter table public.challenge_stages
  add column if not exists advance_top_n integer check (advance_top_n is null or advance_top_n between 1 and 100000);
create index if not exists challenge_campaigns_format on public.challenge_campaigns(format, status, visibility);

-- 2. Who may create: anyone signed in with an active, non-managed account (learners create and share; the daily limit is lower for them).
create or replace function public.qb_challenge_creator() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user();
$fn$;

-- 3. Audience: a campaign aimed at a class or a school is open only to its members, its teacher or administrators, and its owner.
create or replace function public.qb_challenge_in_audience(c public.challenge_campaigns) returns boolean language sql stable security definer set search_path = '' as $fn$
  select (c.audience_class_id is null and c.audience_institution_id is null)
    or c.owner_id = auth.uid()
    or exists (select 1 from public.class_memberships m where m.class_id = c.audience_class_id and m.student_user_id = auth.uid() and lower(m.status::text) = 'active')
    or exists (select 1 from public.classes k where k.id = c.audience_class_id and k.teacher_user_id = auth.uid())
    or exists (select 1 from public.institution_memberships im where im.institution_id = c.audience_institution_id and im.user_id = auth.uid() and im.status::text = 'active')
    or exists (select 1 from public.class_memberships m join public.classes k on k.id = m.class_id
                where k.institution_id = c.audience_institution_id and m.student_user_id = auth.uid() and lower(m.status::text) = 'active')
$fn$;

create or replace function public.qb_challenge_school_admin(p_institution uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_institution is not null and exists (select 1 from public.institution_memberships im where im.institution_id = p_institution and im.user_id = auth.uid()
                                               and im.role::text in ('admin','owner') and im.status::text = 'active');
$fn$;

-- The classes and schools this person may aim a campaign at.
create or replace function public.challenge_my_audiences() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.class_name) order by k.class_name) from public.classes k
                          where lower(k.status::text) = 'active' and (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id))), '[]'::jsonb),
    'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.institutions i
                               where public.qb_challenge_school_admin(i.id)), '[]'::jsonb));
$fn$;

create or replace function public.challenge_set_audience(p_id uuid, p_class uuid default null, p_institution uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k public.classes;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_class is not null and p_institution is not null then raise exception 'INVALID_AUDIENCE' using errcode = '22023'; end if;
  if p_class is not null then
    select * into k from public.classes where id = p_class;
    if not found or not (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;
  if p_institution is not null and not (public.qb_challenge_school_admin(p_institution) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.challenge_campaigns set audience_class_id = p_class, audience_institution_id = p_institution,
         visibility = case when (p_class is not null or p_institution is not null) and visibility = 'PUBLIC' then 'UNLISTED' else visibility end, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_audience_set', p_id, jsonb_build_object('class', p_class, 'institution', p_institution));
  return jsonb_build_object('ok', true);
end $fn$;

-- 4. Creating: a format, and a lower daily limit for learners.
drop function if exists public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text);
create or replace function public.challenge_create(p_title text, p_summary text, p_category text, p_visibility text, p_question_count integer, p_time_limit_seconds integer,
  p_max_attempts integer, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_reward_text text default null, p_access_code text default null,
  p_format text default 'CHALLENGE') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0; v_id uuid; v_format text := upper(coalesce(nullif(btrim(p_format), ''), 'CHALLENGE')); v_limit integer;
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_format not in ('CHALLENGE','COMPETITION') then raise exception 'INVALID_FORMAT' using errcode = '22023'; end if;
  v_limit := case when exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) = 'student') then 5 else 20 end;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= v_limit then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := lower(v_format); end if;
  base := left(base, 50); s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, question_count, time_limit_seconds, max_attempts, starts_at, ends_at, reward_text, access_code, format)
  values (auth.uid(), s, btrim(p_title), coalesce(p_summary, ''), coalesce(p_category, 'general_knowledge'), coalesce(p_visibility, 'PUBLIC'), coalesce(p_question_count, 10),
          coalesce(p_time_limit_seconds, 600), coalesce(p_max_attempts, 1), p_starts_at, p_ends_at, nullif(btrim(p_reward_text), ''), nullif(btrim(p_access_code), ''), v_format)
  returning id into v_id;
  perform public.qb_challenge_audit('challenge_created', v_id, jsonb_build_object('format', v_format));
  return jsonb_build_object('id', v_id, 'slug', s, 'format', v_format);
end $fn$;

-- 5. Rounds. A Challenge is one round; a Competition has up to six. A round can pass people on by a pass mark and by "top N go through" once the round has closed.
create or replace function public.challenge_set_stages(p_id uuid, p_stages jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; s jsonb; i integer := 0; n integer; top integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_stages) <> 'array' then raise exception 'INVALID_STAGES' using errcode = '22023'; end if;
  n := jsonb_array_length(p_stages);
  if n not between 1 and 6 then raise exception 'INVALID_STAGES' using errcode = '22023'; end if;
  if c.format = 'CHALLENGE' and n > 1 then raise exception 'CHALLENGE_SINGLE_ROUND' using errcode = '22023'; end if;
  delete from public.challenge_stages where campaign_id = p_id;
  for s in select * from jsonb_array_elements(p_stages) loop
    i := i + 1;
    top := nullif(s->>'advance_top_n', '')::int;
    if top is not null and (i >= n or nullif(s->>'ends_at', '') is null) then raise exception 'INVALID_STAGES' using errcode = '22023'; end if;
    insert into public.challenge_stages(campaign_id, stage_no, title, question_count, time_limit_seconds, pass_percent, starts_at, ends_at, advance_top_n)
    values (p_id, i, btrim(coalesce(s->>'title', 'Round ' || i)), (s->>'question_count')::int, (s->>'time_limit_seconds')::int, coalesce((s->>'pass_percent')::int, 0),
            nullif(s->>'starts_at', '')::timestamptz, nullif(s->>'ends_at', '')::timestamptz, top);
  end loop;
  update public.challenge_campaigns set stage_count = n, question_count = (p_stages->0->>'question_count')::int, time_limit_seconds = (p_stages->0->>'time_limit_seconds')::int, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_stages_set', p_id, jsonb_build_object('stages', n));
  return jsonb_build_object('ok', true, 'stages', n);
end $fn$;

-- A person's rank within one round: best attempt first, faster wins a tie. Managed learners never count.
create or replace function public.qb_challenge_stage_rank(p_campaign uuid, p_stage integer, p_user uuid) returns integer language sql stable security definer set search_path = '' as $fn$
  select r.rk::integer from (
    select b.user_id, row_number() over (order by b.score desc, b.duration_ms asc, b.submitted_at asc, b.user_id) as rk
      from (select distinct on (a.user_id) a.user_id, a.score, a.duration_ms, a.submitted_at from public.challenge_attempts a
             where a.campaign_id = p_campaign and a.stage_no = p_stage and a.submitted_at is not null and not a.expired
               and not exists (select 1 from public.student_profiles sp where sp.user_id = a.user_id and sp.managed_by is not null)
             order by a.user_id, a.score desc, a.duration_ms asc) b) r
   where r.user_id = p_user;
$fn$;

-- Has this person cleared a round? YES | NOT_PLAYED | NO_SCORE (below the pass mark, may retry) | WAITING (round still running) | OUT (not in the top N)
create or replace function public.qb_challenge_cleared(p_campaign uuid, p_stage integer, p_user uuid) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare d record; best record; n integer; rk integer;
begin
  select * into d from public.qb_challenge_stage(p_campaign, p_stage);
  select s.advance_top_n into n from public.challenge_stages s where s.campaign_id = p_campaign and s.stage_no = p_stage;
  select a.score, a.max_score into best from public.challenge_attempts a
   where a.campaign_id = p_campaign and a.user_id = p_user and a.stage_no = p_stage and a.submitted_at is not null and not a.expired order by a.score desc, a.duration_ms asc limit 1;
  if best.score is null then return 'NOT_PLAYED'; end if;
  if not (best.max_score > 0 and best.score * 100 >= d.pass_percent * best.max_score) then return 'NO_SCORE'; end if;
  if n is null then return 'YES'; end if;
  if d.ends_at is null or d.ends_at > now() then return 'WAITING'; end if;
  rk := public.qb_challenge_stage_rank(p_campaign, p_stage, p_user);
  return case when rk is not null and rk <= n then 'YES' else 'OUT' end;
end $fn$;
revoke all on function public.qb_challenge_stage_rank(uuid, integer, uuid), public.qb_challenge_cleared(uuid, integer, uuid), public.qb_challenge_in_audience(public.challenge_campaigns),
  public.qb_challenge_school_admin(uuid) from public, anon, authenticated;

create or replace function public.challenge_my_progress(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; st record; prev text := 'YES'; gone boolean := false; out jsonb := '[]'::jsonb; used integer; best record; state text; topn integer;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  for st in select g as stage_no from generate_series(1, c.stage_count) g loop
    declare d record; begin
      select * into d from public.qb_challenge_stage(c.id, st.stage_no);
      select s.advance_top_n into topn from public.challenge_stages s where s.campaign_id = c.id and s.stage_no = st.stage_no;
      select count(*) into used from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = st.stage_no;
      select a.score, a.max_score into best from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = st.stage_no and a.submitted_at is not null and not a.expired order by a.score desc, a.duration_ms asc limit 1;
      if prev = 'OUT' then gone := true; end if;
      state := case when gone then 'NOT_THROUGH' when prev = 'WAITING' then 'WAITING' when prev <> 'YES' then 'LOCKED'
                    when d.starts_at is not null and d.starts_at > now() then 'NOT_OPEN' when d.ends_at is not null and d.ends_at <= now() then 'CLOSED'
                    when used >= c.max_attempts then 'USED' else 'OPEN' end;
      out := out || jsonb_build_array(jsonb_build_object('stage_no', st.stage_no, 'title', d.title, 'question_count', d.question_count, 'time_limit_seconds', d.time_limit_seconds,
        'pass_percent', d.pass_percent, 'advance_top_n', topn, 'ends_at', d.ends_at, 'state', state, 'attempts_used', used, 'attempts_allowed', c.max_attempts, 'best_score', best.score, 'best_max', best.max_score));
      prev := case when gone then 'OUT' else public.qb_challenge_cleared(c.id, st.stage_no, auth.uid()) end;
    end;
  end loop;
  return out;
end $fn$;

-- 6. The free allowance counts every challenge or competition a learner joins (first join of each), as well as practice sessions.
create or replace function public.qb_free_sessions_used(p_user uuid) returns integer language sql stable security definer set search_path = '' as $fn$
  select ((select count(*) from public.assessments a where a.owner_user_id = p_user and a.reference_type = 'SELF_PRACTICE')
        + (select count(distinct a.campaign_id) from public.challenge_attempts a join public.challenge_campaigns c on c.id = a.campaign_id where a.user_id = p_user and c.owner_id <> p_user))::integer;
$fn$;
create or replace function public.qb_free_allowance_exhausted(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := public.qb_access_free_limit();
begin
  if lim is null or public.qb_has_subscription(p_user) then return false; end if;
  return public.qb_free_sessions_used(p_user) >= lim;
end $fn$;
create or replace function public.qb_my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := public.qb_access_free_limit(); used integer; learner boolean; sub boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select exists (select 1 from public.student_profiles where user_id = auth.uid()) into learner;
  sub := public.qb_has_subscription(auth.uid());
  used := public.qb_free_sessions_used(auth.uid());
  return jsonb_build_object('gated', learner and lim is not null, 'free_limit', lim, 'used', used,
    'remaining', case when lim is null then null else greatest(lim - used, 0) end, 'subscribed', sub,
    'exhausted', learner and public.qb_free_allowance_exhausted(auth.uid()),
    'subscription_until', (select max(valid_until) from public.learner_subscriptions s where s.user_id = auth.uid() and s.status = 'active' and s.valid_until > now()));
end $fn$;
-- Safe to call whether or not the free-allowance migration is present (then nobody is blocked).
create or replace function public.qb_challenge_allowance_blocked(p_user uuid) returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare r boolean := false;
begin
  if to_regprocedure('public.qb_free_allowance_exhausted(uuid)') is null then return false; end if;
  execute 'select public.qb_free_allowance_exhausted($1)' into r using p_user;
  return coalesce(r, false);
end $fn$;
revoke all on function public.qb_free_sessions_used(uuid), public.qb_free_allowance_exhausted(uuid), public.qb_challenge_allowance_blocked(uuid) from public, anon, authenticated;
revoke all on function public.qb_my_access() from public, anon;
grant execute on function public.qb_my_access() to authenticated;

-- 7. Joining: audience, the free allowance on a first join, and round progression.
create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1); v_clear text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  -- First join by a learner uses one free session; people already in keep going through the rounds.
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())
     and public.qb_challenge_allowance_blocked(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED' using errcode = '55000'; end if;
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
  v_exp := now() + make_interval(secs => d.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, stage_no, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), v_stage, made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', d.time_limit_seconds, 'title', c.title, 'stage_no', v_stage, 'stage_title', d.title, 'stage_count', c.stage_count,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;

-- 8. Publishing tells a class or school it has something new; the leaderboard stays inside the audience.
create or replace function public.challenge_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; g integer; need integer; have integer; ungrounded integer; u uuid;
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
  if c.published_at is null and (c.audience_class_id is not null or c.audience_institution_id is not null) then
    for u in select distinct x.uid from (
        select m.student_user_id as uid from public.class_memberships m where m.class_id = c.audience_class_id and lower(m.status::text) = 'active'
        union select m2.student_user_id from public.class_memberships m2 join public.classes k on k.id = m2.class_id where k.institution_id = c.audience_institution_id and lower(m2.status::text) = 'active'
        union select im.user_id from public.institution_memberships im where im.institution_id = c.audience_institution_id and im.status::text = 'active') x
       where x.uid is not null and x.uid <> auth.uid()
         and not exists (select 1 from public.student_profiles sp where sp.user_id = x.uid and sp.managed_by is not null) limit 500 loop
      perform public.qb_challenge_notify(u, case when c.format = 'COMPETITION' then 'A new competition for you' else 'A new challenge for you' end, c.title,
        '/' || case when c.format = 'COMPETITION' then 'competitions' else 'challenges' end || '/' || c.slug, 'system');
    end loop;
  end if;
  perform public.qb_challenge_event(p_id, 'campaign_published'); perform public.qb_challenge_audit('challenge_published', p_id);
  return jsonb_build_object('ok', true, 'slug', c.slug);
end $fn$;

create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') or (c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin())) then return '[]'::jsonb; end if;
  if (c.audience_class_id is not null or c.audience_institution_id is not null) and not (public.qb_challenge_in_audience(c) or public.qb_challenge_admin()) then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select r.rank, r.score, r.max_score, r.duration_ms, r.stages_done,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (r.user_id = auth.uid()) as is_me
      from public.qb_challenge_ranking(c.id) r join public.profiles p on p.id = r.user_id
     order by r.rank limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

-- 9. Cards and lists: carry the format and the audience kind; lists can be filtered by format and never show class or school campaigns.
drop function if exists public.challenge_public_list(integer, integer);
create or replace function public.challenge_public_list(p_limit integer default 24, p_offset integer default 0, p_format text default null) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.category, c.format, c.starts_at, c.ends_at, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text, c.stage_count, c.brand,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants
      from public.challenge_campaigns c
     where c.visibility = 'PUBLIC' and public.qb_challenge_live(c) and c.audience_class_id is null and c.audience_institution_id is null
       and (p_format is null or c.format = upper(p_format))
     order by coalesce(c.starts_at, c.published_at) desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) t;
$fn$;
create or replace function public.challenge_public_get(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then return null; end if;
  if c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then
    return jsonb_build_object('slug', c.slug, 'title', c.title, 'format', c.format, 'private', true, 'live', public.qb_challenge_live(c), 'brand', c.brand);
  end if;
  if c.status not in ('LIVE','PAUSED','COMPLETED') and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title, 'summary', c.summary, 'category', c.category, 'format', c.format, 'visibility', c.visibility, 'status', c.status,
    'audience', case when c.audience_class_id is not null then 'CLASS' when c.audience_institution_id is not null then 'SCHOOL' else 'ANYONE' end,
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text, 'brand', c.brand, 'stage_count', c.stage_count,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_no', s.stage_no, 'title', s.title, 'question_count', s.question_count, 'time_limit_seconds', s.time_limit_seconds, 'pass_percent', s.pass_percent,
                          'advance_top_n', s.advance_top_n, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.stage_no)
                          from public.challenge_stages s where s.campaign_id = c.id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('rank_from', p.rank_from, 'rank_to', p.rank_to, 'kind', p.kind, 'title', p.title, 'details', p.details) order by p.rank_from)
                          from public.challenge_prizes p where p.campaign_id = c.id), '[]'::jsonb),
    'finalized', c.finalized_at is not null,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;
create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.format, c.stage_count, c.question_count, c.starts_at, c.ends_at, c.created_at,
           (c.audience_class_id is not null or c.audience_institution_id is not null) as has_audience,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

-- 10. Sharing is counted (server route with the service role, so a visitor who is not signed in can share too).
create or replace function public.challenge_track_share(p_slug text) returns void language sql security definer set search_path = '' as $fn$
  insert into public.challenge_events(campaign_id, user_id, event) select c.id, auth.uid(), 'campaign_shared' from public.challenge_campaigns c
   where c.slug = lower(btrim(p_slug)) and c.status in ('LIVE','PAUSED','COMPLETED') and c.visibility <> 'PRIVATE';
$fn$;

-- 11. Grants (nothing to anon; public pages read through the service role).
revoke all on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text), public.challenge_set_audience(uuid, uuid, uuid),
  public.challenge_my_audiences(), public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_start(text, text, integer), public.challenge_publish(uuid),
  public.challenge_leaderboard(text, integer), public.challenge_public_list(integer, integer, text), public.challenge_public_get(text), public.challenge_my_campaigns(),
  public.challenge_track_share(text), public.qb_challenge_creator() from public, anon, authenticated;
grant execute on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text), public.challenge_set_audience(uuid, uuid, uuid),
  public.challenge_my_audiences(), public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_start(text, text, integer), public.challenge_publish(uuid),
  public.challenge_my_campaigns(), public.qb_challenge_creator() to authenticated;
grant execute on function public.challenge_leaderboard(text, integer), public.challenge_public_list(integer, integer, text), public.challenge_public_get(text) to authenticated, service_role;
grant execute on function public.challenge_track_share(text) to service_role;

commit;
notify pgrst, 'reload schema';
