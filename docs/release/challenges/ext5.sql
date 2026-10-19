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

