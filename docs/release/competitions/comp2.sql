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
