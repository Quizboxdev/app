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
