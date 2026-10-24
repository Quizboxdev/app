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
