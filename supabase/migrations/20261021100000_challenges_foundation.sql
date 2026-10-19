-- QuizBox Challenges, foundation (Extension Blueprint phase 1; ADR-001: one identity, one question store, server-side scoring, tenant-ready).
-- A campaign is a timed quiz run by an authorised creator: its own question set (typed in or snapshotted from the bank), public or code-protected,
-- scored on the server, with a leaderboard. Everything goes through SECURITY DEFINER functions: the tables have RLS on and no direct grants,
-- so the answer key is never readable by a browser.
--   qb_challenge_creator() / qb_challenge_admin()   who may create / manage any campaign
--   challenge_public_list / challenge_public_get    public discovery of live campaigns (service role on the server; not callable by anon)
--   challenge_create / update / set_questions / pull_bank / publish / set_status   creator lifecycle (server-validated transitions)
--   challenge_start / challenge_submit              participant: start a timed attempt, submit once, scored on the server
--   challenge_leaderboard / challenge_my_*          rankings and own history
-- Managed learners under 13 can neither create nor join (UNDER_13_DESIGN.md). Additive and idempotent; rollback in supabase/rollback/challenges_foundation.sql.

-- 1. New capabilities (data only: the existing check constraint is widened).
alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
  'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin','platform_admin','content_manager',
  'competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer','sme_support','campaign_creator','campaign_admin'));

-- 2. Tables.
create table if not exists public.challenge_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  tenant_id uuid,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  title text not null check (length(btrim(title)) between 3 and 120),
  summary text not null default '' check (length(summary) <= 500),
  category text not null default 'general_knowledge' check (category in ('school','book','general_knowledge','curriculum','sponsor','community')),
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC','UNLISTED','PRIVATE')),
  status text not null default 'DRAFT' check (status in ('DRAFT','LIVE','PAUSED','COMPLETED','ARCHIVED')),
  access_code text check (access_code is null or length(access_code) between 4 and 24),
  starts_at timestamptz, ends_at timestamptz,
  question_count integer not null default 10 check (question_count between 3 and 100),
  time_limit_seconds integer not null default 600 check (time_limit_seconds between 60 and 7200),
  max_attempts integer not null default 1 check (max_attempts between 1 and 10),
  reward_text text check (reward_text is null or length(reward_text) <= 300),
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (visibility <> 'PRIVATE' or access_code is not null)
);
create index if not exists challenge_campaigns_owner on public.challenge_campaigns(owner_id);
create index if not exists challenge_campaigns_live on public.challenge_campaigns(status, visibility);

create table if not exists public.challenge_questions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  position integer not null check (position >= 1),
  question_text text not null check (length(btrim(question_text)) between 5 and 600),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text check (explanation is null or length(explanation) <= 800),
  source_question_id uuid,
  created_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  attempt_no integer not null,
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score integer, max_score integer, duration_ms integer, expired boolean not null default false,
  unique (campaign_id, user_id, attempt_no)
);
create index if not exists challenge_attempts_board on public.challenge_attempts(campaign_id, score desc, duration_ms) where submitted_at is not null and not expired;

create table if not exists public.challenge_responses (
  attempt_id uuid not null references public.challenge_attempts(id) on delete cascade,
  question_id uuid not null references public.challenge_questions(id) on delete cascade,
  chosen_index smallint, is_correct boolean not null,
  primary key (attempt_id, question_id)
);

create table if not exists public.challenge_events (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.challenge_campaigns(id) on delete cascade,
  user_id uuid,
  event text not null check (event in ('campaign_published','campaign_paused','campaign_completed','campaign_viewed','attempt_started','attempt_submitted','campaign_shared')),
  created_at timestamptz not null default now()
);
create index if not exists challenge_events_campaign on public.challenge_events(campaign_id, event);

alter table public.challenge_campaigns enable row level security;
alter table public.challenge_questions enable row level security;
alter table public.challenge_attempts enable row level security;
alter table public.challenge_responses enable row level security;
alter table public.challenge_events enable row level security;
revoke all on public.challenge_campaigns, public.challenge_questions, public.challenge_attempts, public.challenge_responses, public.challenge_events from anon, authenticated, public;

-- 3. Who may do what.
create or replace function public.qb_challenge_active_user() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active')
    and not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null);
$fn$;
create or replace function public.qb_challenge_admin() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user() and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('owner','admin'))
    or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability in ('super_admin','campaign_admin')));
$fn$;
create or replace function public.qb_challenge_creator() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user() and (
    public.qb_challenge_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('teacher','sponsor'))
    or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability = 'campaign_creator'));
$fn$;
create or replace function public.qb_challenge_live(c public.challenge_campaigns) returns boolean language sql stable set search_path = '' as $fn$
  select c.status = 'LIVE' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now());
$fn$;
create or replace function public.qb_challenge_audit(p_action text, p_id uuid, p_details jsonb default '{}') returns void language sql security definer set search_path = '' as $fn$
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, 'challenge_campaign', p_id, 'ok', p_details);
$fn$;
create or replace function public.qb_challenge_event(p_campaign uuid, p_event text) returns void language sql security definer set search_path = '' as $fn$
  insert into public.challenge_events(campaign_id, user_id, event) values (p_campaign, auth.uid(), p_event);
$fn$;
revoke all on function public.qb_challenge_audit(text, uuid, jsonb), public.qb_challenge_event(uuid, text), public.qb_challenge_live(public.challenge_campaigns) from public, anon, authenticated;

-- 4. Anonymous discovery: live public campaigns only. Never returns questions or the access code.
create or replace function public.challenge_public_list(p_limit integer default 24, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.category, c.starts_at, c.ends_at, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants
      from public.challenge_campaigns c
     where c.visibility = 'PUBLIC' and public.qb_challenge_live(c)
     order by coalesce(c.starts_at, c.published_at) desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) t;
$fn$;
create or replace function public.challenge_public_get(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then return null; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then
    return jsonb_build_object('slug', c.slug, 'title', c.title, 'private', true, 'live', public.qb_challenge_live(c));
  end if;
  if c.status not in ('LIVE','PAUSED','COMPLETED') and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title, 'summary', c.summary, 'category', c.category, 'visibility', c.visibility, 'status', c.status,
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;

-- 5. Creator lifecycle.
create or replace function public.challenge_create(p_title text, p_summary text, p_category text, p_visibility text, p_question_count integer, p_time_limit_seconds integer,
  p_max_attempts integer, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_reward_text text default null, p_access_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0; v_id uuid;
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := 'challenge'; end if;
  base := left(base, 50); s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, question_count, time_limit_seconds, max_attempts, starts_at, ends_at, reward_text, access_code)
  values (auth.uid(), s, btrim(p_title), coalesce(p_summary, ''), coalesce(p_category, 'general_knowledge'), coalesce(p_visibility, 'PUBLIC'), coalesce(p_question_count, 10),
          coalesce(p_time_limit_seconds, 600), coalesce(p_max_attempts, 1), p_starts_at, p_ends_at, nullif(btrim(p_reward_text), ''), nullif(btrim(p_access_code), ''))
  returning id into v_id;
  perform public.qb_challenge_audit('challenge_created', v_id);
  return jsonb_build_object('id', v_id, 'slug', s);
end $fn$;

create or replace function public.qb_challenge_owned(p_id uuid) returns public.challenge_campaigns language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (c.owner_id = auth.uid() and public.qb_challenge_creator() or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return c;
end $fn$;
revoke all on function public.qb_challenge_owned(uuid) from public, anon, authenticated;

create or replace function public.challenge_update(p_id uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k text;
begin
  c := public.qb_challenge_owned(p_id);
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title','summary','category','visibility','question_count','time_limit_seconds','max_attempts','starts_at','ends_at','reward_text','access_code') then
      raise exception 'FIELD_NOT_EDITABLE' using errcode = '22023'; end if;
  end loop;
  if c.status <> 'DRAFT' and p_patch ?| array['category','visibility','question_count','time_limit_seconds','max_attempts','access_code'] then
    raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  update public.challenge_campaigns set
    title = coalesce(nullif(btrim(p_patch->>'title'), ''), title), summary = coalesce(p_patch->>'summary', summary),
    category = coalesce(p_patch->>'category', category), visibility = coalesce(p_patch->>'visibility', visibility),
    question_count = coalesce((p_patch->>'question_count')::int, question_count), time_limit_seconds = coalesce((p_patch->>'time_limit_seconds')::int, time_limit_seconds),
    max_attempts = coalesce((p_patch->>'max_attempts')::int, max_attempts),
    starts_at = case when p_patch ? 'starts_at' then (p_patch->>'starts_at')::timestamptz else starts_at end,
    ends_at = case when p_patch ? 'ends_at' then (p_patch->>'ends_at')::timestamptz else ends_at end,
    reward_text = case when p_patch ? 'reward_text' then nullif(btrim(p_patch->>'reward_text'), '') else reward_text end,
    access_code = case when p_patch ? 'access_code' then nullif(btrim(p_patch->>'access_code'), '') else access_code end,
    updated_at = now()
   where id = p_id;
  perform public.qb_challenge_audit('challenge_updated', p_id);
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_set_questions(p_id uuid, p_questions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; q jsonb; i integer := 0; n integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 0 and 200 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  delete from public.challenge_questions where campaign_id = p_id;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    n := jsonb_array_length(q->'options');
    if (q->>'correct_index')::int not between 0 and n - 1 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation)
    values (p_id, i, btrim(q->>'question_text'), q->'options', (q->>'correct_index')::int, nullif(btrim(q->>'explanation'), ''));
  end loop;
  update public.challenge_campaigns set updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_questions_set', p_id, jsonb_build_object('count', i));
  return jsonb_build_object('ok', true, 'count', i);
end $fn$;

-- Snapshots random active bank questions (single choice) into the campaign, so later bank edits never change a running challenge.
create or replace function public.challenge_pull_bank(p_id uuid, p_subject_code text, p_grade text, p_count integer) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer; added integer := 0; r record;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  select count(*) into have from public.challenge_questions where campaign_id = p_id;
  for r in
    select q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, upper(q.correct_answer) as ans, q.explanation
      from public.questions q
     where q.status = 'active' and q.answer_type = 'SINGLE_CHOICE' and q.subject_code = p_subject_code and (p_grade is null or q.grade::text = p_grade)
       and q.option_c is not null and q.option_d is not null and upper(q.correct_answer) in ('A','B','C','D')
       and not exists (select 1 from public.challenge_questions cq where cq.campaign_id = p_id and cq.source_question_id = q.id)
     order by random() limit least(greatest(coalesce(p_count, 10), 1), 100)
  loop
    have := have + 1; added := added + 1;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id)
    values (p_id, have, r.question_text, jsonb_build_array(r.option_a, r.option_b, r.option_c, r.option_d), ascii(r.ans) - 65, r.explanation, r.id);
  end loop;
  perform public.qb_challenge_audit('challenge_bank_pulled', p_id, jsonb_build_object('added', added, 'subject', p_subject_code));
  return jsonb_build_object('ok', true, 'added', added, 'total', have);
end $fn$;

create or replace function public.challenge_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  select count(*) into have from public.challenge_questions where campaign_id = p_id;
  if have < c.question_count then raise exception 'NOT_ENOUGH_QUESTIONS' using errcode = '55000'; end if;
  if c.ends_at is not null and c.ends_at <= now() then raise exception 'ENDS_IN_THE_PAST' using errcode = '22023'; end if;
  update public.challenge_campaigns set status = 'LIVE', published_at = coalesce(published_at, now()), updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, 'campaign_published'); perform public.qb_challenge_audit('challenge_published', p_id);
  return jsonb_build_object('ok', true, 'slug', c.slug);
end $fn$;

create or replace function public.challenge_set_status(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  if not ((c.status = 'LIVE' and p_status in ('PAUSED','COMPLETED')) or (c.status = 'PAUSED' and p_status in ('COMPLETED','ARCHIVED')) or (c.status in ('DRAFT','COMPLETED') and p_status = 'ARCHIVED')) then
    raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  update public.challenge_campaigns set status = p_status, updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, case p_status when 'PAUSED' then 'campaign_paused' when 'COMPLETED' then 'campaign_completed' else 'campaign_completed' end);
  perform public.qb_challenge_audit('challenge_' || lower(p_status), p_id);
  return jsonb_build_object('ok', true, 'status', p_status);
end $fn$;

create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.question_count, c.starts_at, c.ends_at, c.created_at,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_creator_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object('campaign', to_jsonb(c),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'question_text', q.question_text, 'options', q.options,
        'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.challenge_questions q where q.campaign_id = p_id), '[]'::jsonb));
end $fn$;

-- 6. Participants.
create or replace function public.challenge_start(p_slug text, p_code text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; made integer; ids uuid[]; v_att uuid; v_exp timestamptz;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  select count(*) into made from public.challenge_attempts where campaign_id = c.id and user_id = auth.uid();
  if made >= c.max_attempts then raise exception 'NO_ATTEMPTS_LEFT' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_attempts where user_id = auth.uid() and started_at > now() - interval '1 hour') >= 30 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  select array_agg(id) into ids from (select id from public.challenge_questions where campaign_id = c.id order by random() limit c.question_count) s;
  if ids is null or cardinality(ids) < c.question_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  v_exp := now() + make_interval(secs => c.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', c.time_limit_seconds, 'title', c.title,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;

create or replace function public.challenge_submit(p_attempt uuid, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.challenge_attempts; v_score integer := 0; v_max integer; v_ms integer; item jsonb; q public.challenge_questions; v_choice integer; v_ok boolean;
begin
  select * into a from public.challenge_attempts where id = p_attempt and user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_max := cardinality(a.question_ids);
  if a.submitted_at is not null then
    return jsonb_build_object('ok', not a.expired, 'expired', a.expired, 'score', a.score, 'max_score', a.max_score, 'duration_ms', a.duration_ms, 'already_submitted', true);
  end if;
  v_ms := greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::int);
  if now() > a.expires_at + interval '20 seconds' then
    update public.challenge_attempts set submitted_at = now(), score = 0, max_score = v_max, duration_ms = v_ms, expired = true where id = a.id;
    return jsonb_build_object('ok', false, 'expired', true, 'score', 0, 'max_score', v_max);
  end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'INVALID_ANSWERS' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(p_answers) loop
    select * into q from public.challenge_questions where id = (item->>'question_id')::uuid and id = any(a.question_ids);
    continue when not found;
    v_choice := (item->>'chosen_index')::int;
    v_ok := (v_choice is not null and v_choice = q.correct_index);
    insert into public.challenge_responses(attempt_id, question_id, chosen_index, is_correct) values (a.id, q.id, v_choice, v_ok) on conflict do nothing;
    if v_ok then v_score := v_score + 1; end if;
  end loop;
  insert into public.challenge_responses(attempt_id, question_id, chosen_index, is_correct)
    select a.id, qid, null, false from unnest(a.question_ids) qid on conflict do nothing;
  update public.challenge_attempts set submitted_at = now(), score = v_score, max_score = v_max, duration_ms = v_ms where id = a.id;
  perform public.qb_challenge_event(a.campaign_id, 'attempt_submitted');
  return jsonb_build_object('ok', true, 'score', v_score, 'max_score', v_max, 'duration_ms', v_ms,
    'review', (select jsonb_agg(jsonb_build_object('question_id', r.question_id, 'chosen_index', r.chosen_index, 'is_correct', r.is_correct,
        'correct_index', cq.correct_index, 'explanation', cq.explanation) order by array_position(a.question_ids, r.question_id))
                 from public.challenge_responses r join public.challenge_questions cq on cq.id = r.question_id where r.attempt_id = a.id));
end $fn$;

-- Best attempt per participant; public campaigns (and the owner of any) only. Names are first name plus last initial; managed learners never appear.
create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select row_number() over (order by b.score desc, b.duration_ms asc, b.submitted_at asc) as rank, b.score, b.max_score, b.duration_ms,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (b.user_id = auth.uid()) as is_me
      from (select distinct on (a.user_id) a.* from public.challenge_attempts a
             where a.campaign_id = c.id and a.submitted_at is not null and not a.expired
             order by a.user_id, a.score desc, a.duration_ms asc) b
      join public.profiles p on p.id = b.user_id
     where not exists (select 1 from public.student_profiles sp where sp.user_id = b.user_id and sp.managed_by is not null)
     order by b.score desc, b.duration_ms asc, b.submitted_at asc limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_my_attempts() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t) order by t.started_at desc), '[]'::jsonb) from (
    select c.slug, c.title, a.attempt_no, a.score, a.max_score, a.duration_ms, a.started_at, a.submitted_at, a.expired
      from public.challenge_attempts a join public.challenge_campaigns c on c.id = a.campaign_id
     where a.user_id = auth.uid() order by a.started_at desc limit 100) t;
$fn$;

-- 7. Grants: nothing is granted to anon; participants and creators need a signed-in user (each function also checks who is calling).
revoke all on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text),
  public.challenge_update(uuid, jsonb), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer), public.challenge_publish(uuid),
  public.challenge_set_status(uuid, text), public.challenge_my_campaigns(), public.challenge_creator_get(uuid), public.challenge_start(text, text), public.challenge_submit(uuid, jsonb),
  public.challenge_leaderboard(text, integer), public.challenge_my_attempts(), public.qb_challenge_active_user(), public.qb_challenge_admin(), public.qb_challenge_creator() from public, anon, authenticated;
-- Public pages read these on the server with the service role (SEO, no anonymous database permission); signed-in users may call them too.
grant execute on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
grant execute on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text), public.challenge_update(uuid, jsonb),
  public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer), public.challenge_publish(uuid), public.challenge_set_status(uuid, text),
  public.challenge_my_campaigns(), public.challenge_creator_get(uuid), public.challenge_start(text, text), public.challenge_submit(uuid, jsonb), public.challenge_my_attempts(),
  public.qb_challenge_creator() to authenticated;
