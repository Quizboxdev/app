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
