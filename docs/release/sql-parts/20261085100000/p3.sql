create or replace function public.qb_family_my_challenges() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('campaign_id', c.id, 'slug', c.slug, 'title', c.title, 'ends_at', c.ends_at, 'starts_at', c.starts_at,
      'access_code', case when c.visibility = 'PRIVATE' then c.access_code end, 'from', coalesce(nullif(o.full_name, ''), 'Your family')) order by i.created_at desc)
    from public.family_challenge_invites i join public.challenge_campaigns c on c.id = i.campaign_id join public.profiles o on o.id = i.invited_by
    where i.student_user_id = auth.uid() and c.status = 'LIVE' and (c.ends_at is null or c.ends_at > now())), '[]'::jsonb);
end $fn$;

revoke all on function public.qb_family_challenges(), public.qb_family_invite_challenge(uuid, uuid[]), public.qb_family_uninvite_challenge(uuid, uuid), public.qb_family_my_challenges() from public, anon, authenticated;
grant execute on function public.qb_family_challenges(), public.qb_family_invite_challenge(uuid, uuid[]), public.qb_family_uninvite_challenge(uuid, uuid), public.qb_family_my_challenges() to authenticated;

notify pgrst, 'reload schema';
