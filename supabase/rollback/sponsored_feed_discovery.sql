create or replace function public.challenge_featured(p_limit integer default 8, p_level text default null) returns jsonb
language sql stable security definer set search_path = '' as $fn$
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
