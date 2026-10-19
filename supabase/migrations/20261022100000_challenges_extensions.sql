-- QuizBox Challenges, extensions: multi-round stages, uploaded source content (versioned, with question evidence), prizes and fulfilment, organiser branding, analytics.
-- Builds on 20261021100000_challenges_foundation.sql. Same rules: tables have RLS on and no direct grants, everything goes through SECURITY DEFINER functions
-- with a fixed search_path, managed under-13 learners are excluded, additive and idempotent. Rollback: supabase/rollback/challenges_extensions.sql.
--   Stages:    challenge_set_stages / challenge_my_progress; start and submit are stage aware; a stage unlocks when the previous pass mark is met.
--   Content:   challenge_content_add / challenge_content_list / challenge_content_chunks; questions can cite a passage (chunk) and a verbatim quote.
--   Prizes:    challenge_set_prizes / challenge_finalize / challenge_awards_list / challenge_award_update / challenge_my_awards.
--   Branding:  challenge_set_brand (organiser name, tagline, accent colour, welcome text).
--   Insight:   challenge_analytics (creator) and challenge_admin_overview (admin).

-- 1. Columns and constraints.
alter table public.challenge_campaigns
  add column if not exists brand jsonb not null default '{}'::jsonb check (jsonb_typeof(brand) = 'object'),
  add column if not exists stage_count integer not null default 1 check (stage_count between 1 and 6),
  add column if not exists finalized_at timestamptz;
alter table public.challenge_questions
  add column if not exists stage_no integer not null default 1 check (stage_no between 1 and 6),
  add column if not exists source_chunk_id uuid,
  add column if not exists source_quote text check (source_quote is null or length(source_quote) <= 300);
alter table public.challenge_attempts add column if not exists stage_no integer not null default 1;
alter table public.challenge_attempts drop constraint if exists challenge_attempts_campaign_id_user_id_attempt_no_key;
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'challenge_attempts_stage_unique') then
    alter table public.challenge_attempts add constraint challenge_attempts_stage_unique unique (campaign_id, user_id, stage_no, attempt_no);
  end if;
end $do$;
alter table public.challenge_events drop constraint if exists challenge_events_event_check;
alter table public.challenge_events add constraint challenge_events_event_check check (event in
  ('campaign_published','campaign_paused','campaign_completed','campaign_viewed','attempt_started','attempt_submitted','campaign_shared','campaign_finalized','award_issued','content_added'));

create table if not exists public.challenge_stages (
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  stage_no integer not null check (stage_no between 1 and 6),
  title text not null check (length(btrim(title)) between 1 and 80),
  question_count integer not null check (question_count between 3 and 100),
  time_limit_seconds integer not null check (time_limit_seconds between 60 and 7200),
  pass_percent integer not null default 0 check (pass_percent between 0 and 100),
  starts_at timestamptz, ends_at timestamptz,
  primary key (campaign_id, stage_no),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table if not exists public.challenge_content_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  title text not null check (length(btrim(title)) between 2 and 160),
  kind text not null default 'book' check (kind in ('book','article','notes')),
  rights_attested boolean not null check (rights_attested),
  current_version integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.challenge_content_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.challenge_content_assets(id) on delete cascade,
  version integer not null,
  source_name text check (source_name is null or length(source_name) <= 200),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  char_count integer not null, chunk_count integer not null,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  unique (asset_id, version)
);
create table if not exists public.challenge_source_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.challenge_content_versions(id) on delete cascade,
  position integer not null,
  heading text check (heading is null or length(heading) <= 160),
  body text not null check (length(body) between 20 and 2500),
  unique (version_id, position)
);
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'challenge_questions_chunk_fk') then
    alter table public.challenge_questions add constraint challenge_questions_chunk_fk foreign key (source_chunk_id) references public.challenge_source_chunks(id) on delete set null;
  end if;
end $do$;
create table if not exists public.challenge_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  rank_from integer not null check (rank_from >= 1), rank_to integer not null,
  kind text not null default 'recognition' check (kind in ('cash','goods','voucher','certificate','recognition')),
  title text not null check (length(btrim(title)) between 2 and 120),
  details text check (details is null or length(details) <= 400),
  check (rank_to >= rank_from and rank_to <= 100)
);
create table if not exists public.challenge_awards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  prize_id uuid not null references public.challenge_prizes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  rank integer not null,
  status text not null default 'PENDING' check (status in ('PENDING','CONTACTED','FULFILLED','FORFEITED')),
  fulfilment_note text check (fulfilment_note is null or length(fulfilment_note) <= 400),
  updated_at timestamptz not null default now(), fulfilled_at timestamptz,
  unique (campaign_id, user_id, prize_id)
);
alter table public.challenge_stages enable row level security;
alter table public.challenge_content_assets enable row level security;
alter table public.challenge_content_versions enable row level security;
alter table public.challenge_source_chunks enable row level security;
alter table public.challenge_prizes enable row level security;
alter table public.challenge_awards enable row level security;
revoke all on public.challenge_stages, public.challenge_content_assets, public.challenge_content_versions, public.challenge_source_chunks, public.challenge_prizes, public.challenge_awards from anon, authenticated, public;
create index if not exists challenge_awards_user on public.challenge_awards(user_id);
create index if not exists challenge_questions_stage on public.challenge_questions(campaign_id, stage_no);

-- 2. Shared helpers (internal).
create or replace function public.qb_challenge_stage(p_campaign uuid, p_stage integer) returns table(title text, question_count integer, time_limit_seconds integer, pass_percent integer, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select coalesce(s.title, 'Round ' || p_stage), coalesce(s.question_count, c.question_count), coalesce(s.time_limit_seconds, c.time_limit_seconds), coalesce(s.pass_percent, 0),
         coalesce(s.starts_at, case when p_stage = 1 then c.starts_at end), coalesce(s.ends_at, case when p_stage = c.stage_count then c.ends_at end)
    from public.challenge_campaigns c left join public.challenge_stages s on s.campaign_id = c.id and s.stage_no = p_stage where c.id = p_campaign;
$fn$;
create or replace function public.qb_challenge_ranking(p_campaign uuid) returns table(user_id uuid, rank bigint, stages_done integer, score integer, max_score integer, duration_ms bigint)
language sql stable security definer set search_path = '' as $fn$
  with best as (
    select distinct on (a.user_id, a.stage_no) a.user_id, a.stage_no, a.score, a.max_score, a.duration_ms
      from public.challenge_attempts a where a.campaign_id = p_campaign and a.submitted_at is not null and not a.expired
     order by a.user_id, a.stage_no, a.score desc, a.duration_ms asc),
  tot as (select b.user_id, count(*)::int as stages_done, sum(b.score)::int as score, sum(b.max_score)::int as max_score, sum(b.duration_ms)::bigint as duration_ms from best b group by b.user_id)
  select t.user_id, row_number() over (order by t.stages_done desc, t.score desc, t.duration_ms asc, t.user_id), t.stages_done, t.score, t.max_score, t.duration_ms
    from tot t where not exists (select 1 from public.student_profiles sp where sp.user_id = t.user_id and sp.managed_by is not null);
$fn$;
create or replace function public.qb_challenge_norm(p text) returns text language sql immutable set search_path = '' as $fn$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$fn$;
revoke all on function public.qb_challenge_stage(uuid, integer), public.qb_challenge_ranking(uuid), public.qb_challenge_norm(text) from public, anon, authenticated;

-- 3. Stages.
create or replace function public.challenge_set_stages(p_id uuid, p_stages jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; s jsonb; i integer := 0; n integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_stages) <> 'array' then raise exception 'INVALID_STAGES' using errcode = '22023'; end if;
  n := jsonb_array_length(p_stages);
  if n not between 1 and 6 then raise exception 'INVALID_STAGES' using errcode = '22023'; end if;
  delete from public.challenge_stages where campaign_id = p_id;
  for s in select * from jsonb_array_elements(p_stages) loop
    i := i + 1;
    insert into public.challenge_stages(campaign_id, stage_no, title, question_count, time_limit_seconds, pass_percent, starts_at, ends_at)
    values (p_id, i, btrim(coalesce(s->>'title', 'Round ' || i)), (s->>'question_count')::int, (s->>'time_limit_seconds')::int, coalesce((s->>'pass_percent')::int, 0),
            nullif(s->>'starts_at', '')::timestamptz, nullif(s->>'ends_at', '')::timestamptz);
  end loop;
  update public.challenge_campaigns set stage_count = n, question_count = (p_stages->0->>'question_count')::int, time_limit_seconds = (p_stages->0->>'time_limit_seconds')::int, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_stages_set', p_id, jsonb_build_object('stages', n));
  return jsonb_build_object('ok', true, 'stages', n);
end $fn$;

create or replace function public.challenge_my_progress(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; st record; prev_ok boolean := true; out jsonb := '[]'::jsonb; used integer; best record; state text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  for st in select g as stage_no from generate_series(1, c.stage_count) g loop
    declare d record; begin
      select * into d from public.qb_challenge_stage(c.id, st.stage_no);
      select count(*) into used from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = st.stage_no;
      select a.score, a.max_score into best from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = st.stage_no and a.submitted_at is not null and not a.expired order by a.score desc, a.duration_ms asc limit 1;
      state := case when not prev_ok then 'LOCKED' when d.starts_at is not null and d.starts_at > now() then 'NOT_OPEN' when d.ends_at is not null and d.ends_at <= now() then 'CLOSED'
                    when used >= c.max_attempts then 'USED' else 'OPEN' end;
      out := out || jsonb_build_array(jsonb_build_object('stage_no', st.stage_no, 'title', d.title, 'question_count', d.question_count, 'time_limit_seconds', d.time_limit_seconds,
        'pass_percent', d.pass_percent, 'state', state, 'attempts_used', used, 'attempts_allowed', c.max_attempts, 'best_score', best.score, 'best_max', best.max_score));
      prev_ok := best.score is not null and best.max_score > 0 and best.score * 100 >= d.pass_percent * best.max_score;
    end;
  end loop;
  return out;
end $fn$;

-- 4. Questions (stage, passage and quote), bank pull, publish, creator view.
create or replace function public.challenge_set_questions(p_id uuid, p_questions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; q jsonb; i integer := 0; n integer; v_stage integer; v_chunk uuid; v_quote text; v_body text;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 0 and 300 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  delete from public.challenge_questions where campaign_id = p_id;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    n := jsonb_array_length(q->'options');
    if (q->>'correct_index')::int not between 0 and n - 1 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    v_stage := coalesce((q->>'stage_no')::int, 1);
    if v_stage not between 1 and c.stage_count then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    v_chunk := nullif(q->>'source_chunk_id', '')::uuid; v_quote := nullif(btrim(q->>'source_quote'), '');
    if v_chunk is not null then
      select ch.body into v_body from public.challenge_source_chunks ch join public.challenge_content_versions v on v.id = ch.version_id
        join public.challenge_content_assets a on a.id = v.asset_id where ch.id = v_chunk and a.campaign_id = p_id;
      if not found then raise exception 'INVALID_SOURCE' using errcode = '22023'; end if;
      if v_quote is not null and position(public.qb_challenge_norm(v_quote) in public.qb_challenge_norm(v_body)) = 0 then raise exception 'QUOTE_NOT_IN_SOURCE' using errcode = '22023'; end if;
    elsif v_quote is not null then raise exception 'INVALID_SOURCE' using errcode = '22023'; end if;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, stage_no, source_chunk_id, source_quote)
    values (p_id, i, btrim(q->>'question_text'), q->'options', (q->>'correct_index')::int, nullif(btrim(q->>'explanation'), ''), v_stage, v_chunk, v_quote);
  end loop;
  update public.challenge_campaigns set updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_questions_set', p_id, jsonb_build_object('count', i));
  return jsonb_build_object('ok', true, 'count', i);
end $fn$;

drop function if exists public.challenge_pull_bank(uuid, text, text, integer);
create or replace function public.challenge_pull_bank(p_id uuid, p_subject_code text, p_grade text, p_count integer, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer; added integer := 0; r record;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_stage not between 1 and c.stage_count then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
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
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no)
    values (p_id, have, r.question_text, jsonb_build_array(r.option_a, r.option_b, r.option_c, r.option_d), ascii(r.ans) - 65, r.explanation, r.id, p_stage);
  end loop;
  perform public.qb_challenge_audit('challenge_bank_pulled', p_id, jsonb_build_object('added', added, 'subject', p_subject_code, 'stage', p_stage));
  return jsonb_build_object('ok', true, 'added', added, 'total', have);
end $fn$;

create or replace function public.challenge_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; g integer; need integer; have integer; ungrounded integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
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

create or replace function public.challenge_creator_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object('campaign', to_jsonb(c),
    'stages', coalesce((select jsonb_agg(to_jsonb(s) - 'campaign_id' order by s.stage_no) from public.challenge_stages s where s.campaign_id = p_id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(to_jsonb(p) - 'campaign_id' order by p.rank_from) from public.challenge_prizes p where p.campaign_id = p_id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index,
        'explanation', q.explanation, 'stage_no', q.stage_no, 'source_chunk_id', q.source_chunk_id, 'source_quote', q.source_quote) order by q.position)
        from public.challenge_questions q where q.campaign_id = p_id), '[]'::jsonb));
end $fn$;

-- 5. Public card and list: now carry the organiser's branding and the number of rounds.
create or replace function public.challenge_public_list(p_limit integer default 24, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.category, c.starts_at, c.ends_at, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text, c.stage_count, c.brand,
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

-- 6. Playing: stage aware start and submit, ranking across rounds.
drop function if exists public.challenge_start(text, text);
create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; prev record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1);
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  select * into d from public.qb_challenge_stage(c.id, v_stage);
  if d.starts_at is not null and d.starts_at > now() then raise exception 'STAGE_NOT_OPEN' using errcode = '55000'; end if;
  if d.ends_at is not null and d.ends_at <= now() then raise exception 'STAGE_CLOSED' using errcode = '55000'; end if;
  if v_stage > 1 then
    select * into prev from public.qb_challenge_stage(c.id, v_stage - 1);
    if not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = v_stage - 1 and a.submitted_at is not null and not a.expired
                      and a.max_score > 0 and a.score * 100 >= prev.pass_percent * a.max_score) then raise exception 'STAGE_LOCKED' using errcode = '55000'; end if;
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

create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select r.rank, r.score, r.max_score, r.duration_ms, r.stages_done,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (r.user_id = auth.uid()) as is_me
      from public.qb_challenge_ranking(c.id) r join public.profiles p on p.id = r.user_id
     order by r.rank limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

-- 7. Content: versioned source passages. A new upload is a new version; passages are never edited, so a question's evidence cannot drift.
create or replace function public.challenge_content_add(p_campaign uuid, p_title text, p_kind text, p_source_name text, p_sha256 text, p_chunks jsonb, p_rights boolean, p_asset uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; v_asset uuid := p_asset; v_ver integer; v_vid uuid; ch jsonb; i integer := 0; total integer := 0; n integer;
begin
  c := public.qb_challenge_owned(p_campaign);
  if c.status = 'ARCHIVED' then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if jsonb_typeof(p_chunks) <> 'array' then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  n := jsonb_array_length(p_chunks);
  if n not between 1 and 400 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  if not coalesce(p_rights, false) then raise exception 'RIGHTS_NOT_CONFIRMED' using errcode = '22023'; end if;
  if (select count(*) from public.challenge_content_assets where campaign_id = p_campaign) >= 10 and p_asset is null then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  if v_asset is null then
    insert into public.challenge_content_assets(campaign_id, owner_id, title, kind, rights_attested) values (p_campaign, auth.uid(), btrim(p_title), coalesce(p_kind, 'book'), true) returning id into v_asset;
  elsif not exists (select 1 from public.challenge_content_assets where id = v_asset and campaign_id = p_campaign) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.challenge_content_assets set current_version = current_version + 1 where id = v_asset returning current_version into v_ver;
  insert into public.challenge_content_versions(asset_id, version, source_name, sha256, char_count, chunk_count, created_by) values (v_asset, v_ver, left(p_source_name, 200), nullif(p_sha256, ''), 0, n, auth.uid()) returning id into v_vid;
  for ch in select * from jsonb_array_elements(p_chunks) loop
    i := i + 1; total := total + length(ch->>'body');
    if total > 600000 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
    insert into public.challenge_source_chunks(version_id, position, heading, body) values (v_vid, i, nullif(left(btrim(ch->>'heading'), 160), ''), btrim(ch->>'body'));
  end loop;
  update public.challenge_content_versions set char_count = total where id = v_vid;
  perform public.qb_challenge_event(p_campaign, 'content_added'); perform public.qb_challenge_audit('challenge_content_added', p_campaign, jsonb_build_object('asset', v_asset, 'version', v_ver, 'chunks', n));
  return jsonb_build_object('ok', true, 'asset_id', v_asset, 'version', v_ver, 'version_id', v_vid, 'chunks', n);
end $fn$;

create or replace function public.challenge_content_list(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_challenge_owned(p_campaign);
  return coalesce((select jsonb_agg(jsonb_build_object('asset_id', a.id, 'title', a.title, 'kind', a.kind, 'current_version', a.current_version,
      'versions', (select jsonb_agg(jsonb_build_object('version_id', v.id, 'version', v.version, 'source_name', v.source_name, 'chunk_count', v.chunk_count, 'char_count', v.char_count, 'created_at', v.created_at) order by v.version desc)
                     from public.challenge_content_versions v where v.asset_id = a.id)) order by a.created_at)
    from public.challenge_content_assets a where a.campaign_id = p_campaign), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_content_chunks(p_campaign uuid, p_version uuid, p_limit integer default 100, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_challenge_owned(p_campaign);
  if not exists (select 1 from public.challenge_content_versions v join public.challenge_content_assets a on a.id = v.asset_id where v.id = p_version and a.campaign_id = p_campaign) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'position', ch.position, 'heading', ch.heading, 'body', ch.body) order by ch.position)
    from (select * from public.challenge_source_chunks where version_id = p_version order by position limit least(greatest(coalesce(p_limit, 100), 1), 400) offset greatest(coalesce(p_offset, 0), 0)) ch), '[]'::jsonb);
end $fn$;

-- 8. Prizes and fulfilment. The platform records who won what and tracks delivery; the organiser delivers the prize.
create or replace function public.challenge_set_prizes(p_id uuid, p_prizes jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; pz jsonb; n integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status in ('COMPLETED','ARCHIVED') or c.finalized_at is not null then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) > 20 then raise exception 'INVALID_PRIZES' using errcode = '22023'; end if;
  delete from public.challenge_prizes where campaign_id = p_id;
  for pz in select * from jsonb_array_elements(p_prizes) loop
    insert into public.challenge_prizes(campaign_id, rank_from, rank_to, kind, title, details)
    values (p_id, (pz->>'rank_from')::int, coalesce((pz->>'rank_to')::int, (pz->>'rank_from')::int), coalesce(pz->>'kind', 'recognition'), btrim(pz->>'title'), nullif(btrim(pz->>'details'), ''));
  end loop;
  select count(*) into n from public.challenge_prizes where campaign_id = p_id;
  perform public.qb_challenge_audit('challenge_prizes_set', p_id, jsonb_build_object('count', n));
  return jsonb_build_object('ok', true, 'count', n);
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
  end loop;
  update public.challenge_campaigns set finalized_at = now(), updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, 'campaign_finalized'); perform public.qb_challenge_audit('challenge_finalized', p_id, jsonb_build_object('awards', made));
  return jsonb_build_object('ok', true, 'awards', made);
end $fn$;

-- The organiser sees the winners' contact email so the prize can be delivered; players are told this before they start.
create or replace function public.challenge_awards_list(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_challenge_owned(p_id);
  return coalesce((select jsonb_agg(jsonb_build_object('award_id', a.id, 'rank', a.rank, 'prize', pz.title, 'kind', pz.kind, 'name', p.full_name, 'email', p.email, 'status', a.status, 'note', a.fulfilment_note, 'updated_at', a.updated_at) order by a.rank, pz.rank_from)
    from public.challenge_awards a join public.challenge_prizes pz on pz.id = a.prize_id join public.profiles p on p.id = a.user_id where a.campaign_id = p_id), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_award_update(p_award uuid, p_status text, p_note text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.challenge_awards;
begin
  select * into a from public.challenge_awards where id = p_award;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_challenge_owned(a.campaign_id);
  if p_status not in ('PENDING','CONTACTED','FULFILLED','FORFEITED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  update public.challenge_awards set status = p_status, fulfilment_note = nullif(btrim(p_note), ''), updated_at = now(), fulfilled_at = case when p_status = 'FULFILLED' then now() else null end where id = p_award;
  perform public.qb_challenge_audit('challenge_award_' || lower(p_status), a.campaign_id, jsonb_build_object('award', p_award));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_my_awards() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('campaign', c.title, 'slug', c.slug, 'rank', a.rank, 'prize', pz.title, 'details', pz.details, 'status', a.status, 'updated_at', a.updated_at) order by a.updated_at desc), '[]'::jsonb)
    from public.challenge_awards a join public.challenge_prizes pz on pz.id = a.prize_id join public.challenge_campaigns c on c.id = a.campaign_id where a.user_id = auth.uid();
$fn$;

-- 9. Branding.
create or replace function public.challenge_set_brand(p_id uuid, p_brand jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k text; clean jsonb := '{}'::jsonb; v text;
begin
  c := public.qb_challenge_owned(p_id);
  if jsonb_typeof(p_brand) <> 'object' then raise exception 'INVALID_BRAND' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_brand) loop
    v := nullif(btrim(p_brand->>k), '');
    continue when v is null;
    if k = 'organiser_name' and length(v) <= 60 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'tagline' and length(v) <= 120 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'welcome' and length(v) <= 300 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'accent' and v ~ '^#[0-9a-fA-F]{6}$' then clean := clean || jsonb_build_object(k, lower(v));
    else raise exception 'INVALID_BRAND' using errcode = '22023'; end if;
  end loop;
  update public.challenge_campaigns set brand = clean, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_brand_set', p_id);
  return jsonb_build_object('ok', true, 'brand', clean);
end $fn$;

-- 10. Analytics. Views are counted from the public page (approximate); everything else comes from attempts and responses.
create or replace function public.challenge_track_view(p_slug text) returns void language sql security definer set search_path = '' as $fn$
  insert into public.challenge_events(campaign_id, user_id, event) select c.id, null, 'campaign_viewed' from public.challenge_campaigns c where c.slug = lower(btrim(p_slug)) and c.status in ('LIVE','PAUSED','COMPLETED') and c.visibility <> 'PRIVATE';
$fn$;

create or replace function public.challenge_analytics(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; out jsonb;
begin
  c := public.qb_challenge_owned(p_id);
  select jsonb_build_object(
    'views', (select count(*) from public.challenge_events e where e.campaign_id = p_id and e.event = 'campaign_viewed'),
    'started', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id),
    'players', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = p_id),
    'completed', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'expired', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id and a.expired),
    'avg_score_percent', (select round(avg(100.0 * a.score / nullif(a.max_score, 0)), 1) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'avg_duration_ms', (select round(avg(a.duration_ms)) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'distribution', (select coalesce(jsonb_agg(jsonb_build_object('band', b.band, 'count', b.n) order by b.band), '[]'::jsonb) from (
        select (least(floor(100.0 * a.score / nullif(a.max_score, 0) / 20), 4) * 20)::int as band, count(*) as n
          from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired and a.max_score > 0 group by 1) b),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('stage_no', g.stage_no, 'started', coalesce(x.started, 0), 'completed', coalesce(x.completed, 0), 'players', coalesce(x.players, 0)) order by g.stage_no), '[]'::jsonb)
        from generate_series(1, c.stage_count) g(stage_no) left join (
          select a.stage_no, count(*) as started, count(*) filter (where a.submitted_at is not null and not a.expired) as completed, count(distinct a.user_id) as players
            from public.challenge_attempts a where a.campaign_id = p_id group by a.stage_no) x on x.stage_no = g.stage_no),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('position', q.position, 'stage_no', q.stage_no, 'text', left(q.question_text, 90), 'answered', coalesce(s.answered, 0), 'percent_correct', s.pct) order by q.position), '[]'::jsonb)
        from public.challenge_questions q left join (
          select r.question_id, count(*) filter (where r.chosen_index is not null) as answered, round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 1) as pct
            from public.challenge_responses r join public.challenge_attempts a on a.id = r.attempt_id where a.campaign_id = p_id group by r.question_id) s on s.question_id = q.id
        where q.campaign_id = p_id),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'starts', d.n) order by d.day), '[]'::jsonb) from (
        select (a.started_at at time zone 'UTC')::date as day, count(*) as n from public.challenge_attempts a where a.campaign_id = p_id and a.started_at > now() - interval '30 days' group by 1) d)
  ) into out;
  return out;
end $fn$;

create or replace function public.challenge_admin_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaigns', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) as n from public.challenge_campaigns group by status) s),
    'attempts_30d', (select count(*) from public.challenge_attempts where started_at > now() - interval '30 days'),
    'players_30d', (select count(distinct user_id) from public.challenge_attempts where started_at > now() - interval '30 days'),
    'awards_pending', (select count(*) from public.challenge_awards where status in ('PENDING','CONTACTED')),
    'top', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select c.slug, c.title, c.status, count(distinct a.user_id) as players from public.challenge_campaigns c left join public.challenge_attempts a on a.campaign_id = c.id
         group by c.id order by players desc, c.created_at desc limit 10) t));
end $fn$;

-- 11. Grants.
revoke all on function public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer, integer),
  public.challenge_publish(uuid), public.challenge_creator_get(uuid), public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_start(text, text, integer),
  public.challenge_leaderboard(text, integer), public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid), public.challenge_content_list(uuid), public.challenge_content_chunks(uuid, uuid, integer, integer),
  public.challenge_set_prizes(uuid, jsonb), public.challenge_finalize(uuid), public.challenge_awards_list(uuid), public.challenge_award_update(uuid, text, text), public.challenge_my_awards(),
  public.challenge_set_brand(uuid, jsonb), public.challenge_track_view(text), public.challenge_analytics(uuid), public.challenge_admin_overview() from public, anon, authenticated;
grant execute on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
grant execute on function public.challenge_track_view(text) to service_role;
grant execute on function public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer, integer),
  public.challenge_publish(uuid), public.challenge_creator_get(uuid), public.challenge_start(text, text, integer), public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid),
  public.challenge_content_list(uuid), public.challenge_content_chunks(uuid, uuid, integer, integer), public.challenge_set_prizes(uuid, jsonb), public.challenge_finalize(uuid), public.challenge_awards_list(uuid),
  public.challenge_award_update(uuid, text, text), public.challenge_my_awards(), public.challenge_set_brand(uuid, jsonb), public.challenge_analytics(uuid), public.challenge_admin_overview() to authenticated;
