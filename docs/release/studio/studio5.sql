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
    'target_levels', to_jsonb(c.target_levels),
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text, 'brand', c.brand, 'stage_count', c.stage_count,
    'material', case when c.reader_enabled then jsonb_build_object('closes', c.reader_closes,
        'types', coalesce((select jsonb_agg(distinct a.content_type) from public.challenge_content_assets a where a.campaign_id = c.id and a.current_version > 0), '[]'::jsonb),
        'documents', (select count(*) from public.challenge_content_assets a where a.campaign_id = c.id and a.current_version > 0),
        'sections', (select count(*) from public.challenge_sections s join public.challenge_content_versions v on v.id = s.version_id join public.challenge_content_assets a on a.id = v.asset_id
                      where a.campaign_id = c.id and v.version = a.current_version and s.reader_visible)) end,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_no', s.stage_no, 'title', s.title, 'question_count', s.question_count, 'time_limit_seconds', s.time_limit_seconds, 'pass_percent', s.pass_percent,
                          'advance_top_n', s.advance_top_n, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.stage_no)
                          from public.challenge_stages s where s.campaign_id = c.id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('rank_from', p.rank_from, 'rank_to', p.rank_to, 'kind', p.kind, 'title', p.title, 'details', p.details) order by p.rank_from)
                          from public.challenge_prizes p where p.campaign_id = c.id), '[]'::jsonb),
    'finalized', c.finalized_at is not null,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;

-- 9. Sponsored quizzes for the carousel and the sidebar: live, public, branded with a logo, made by a sponsor, admin or owner (or marked as sponsored), aimed at everyone, and matching the viewer's level.
create or replace function public.challenge_featured(p_limit integer default 8, p_level text default null) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.format, c.category, c.brand, c.stage_count, c.question_count, c.reader_enabled as has_material,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants
      from public.challenge_campaigns c
     where c.visibility = 'PUBLIC' and public.qb_challenge_live(c) and c.audience_class_id is null and c.audience_institution_id is null and c.brand ? 'logo'
       and (c.category = 'sponsor' or exists (select 1 from public.profiles p where p.id = c.owner_id and lower(p.role::text) in ('sponsor','admin','owner')))
       and (p_level is null or c.target_levels = '{}' or upper(p_level) = any(c.target_levels))
     order by coalesce(c.published_at, c.created_at) desc
     limit least(greatest(coalesce(p_limit, 8), 1), 12)) t;
$fn$;

-- 10. How much material is hosted, by type (counts only; private campaigns and drafts are left out).
create or replace function public.challenge_library_stats() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'documents', coalesce(sum(n), 0),
    'by_type', coalesce(jsonb_object_agg(content_type, n), '{}'::jsonb))
  from (select a.content_type, count(*)::int as n from public.challenge_content_assets a join public.challenge_campaigns c on c.id = a.campaign_id
         where a.current_version > 0 and c.status in ('LIVE','PAUSED','COMPLETED') and c.visibility <> 'PRIVATE' and c.moderation_state = 'OK' group by a.content_type) x;
$fn$;

-- 11. My list also shows the logo flag, whether material is set, and where a copy came from.
create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.format, c.stage_count, c.question_count, c.starts_at, c.ends_at, c.created_at, c.cloned_from,
           (c.audience_class_id is not null or c.audience_institution_id is not null) as has_audience, c.brand ? 'logo' as has_logo, c.reader_enabled,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

-- 12. Grants.
revoke all on function public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid, text, jsonb), public.challenge_content_list(uuid), public.challenge_sections_set_visible(uuid, uuid[]),
  public.challenge_set_reader(uuid, boolean, text), public.challenge_set_targeting(uuid, text[]), public.challenge_set_brand(uuid, jsonb), public.challenge_join(text, text), public.challenge_start(text, text, integer),
  public.challenge_material(text), public.challenge_material_read(text, uuid), public.challenge_clone(uuid, text), public.challenge_public_get(text), public.challenge_featured(integer, text),
  public.challenge_library_stats(), public.challenge_my_campaigns() from public, anon, authenticated;
grant execute on function public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid, text, jsonb), public.challenge_content_list(uuid), public.challenge_sections_set_visible(uuid, uuid[]),
  public.challenge_set_reader(uuid, boolean, text), public.challenge_set_targeting(uuid, text[]), public.challenge_set_brand(uuid, jsonb), public.challenge_join(text, text), public.challenge_start(text, text, integer),
  public.challenge_material(text), public.challenge_material_read(text, uuid), public.challenge_clone(uuid, text), public.challenge_my_campaigns() to authenticated;
grant execute on function public.challenge_public_get(text), public.challenge_featured(integer, text), public.challenge_library_stats() to authenticated, service_role;

notify pgrst, 'reload schema';

