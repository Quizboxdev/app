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
