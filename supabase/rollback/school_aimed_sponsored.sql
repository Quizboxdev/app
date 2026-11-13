-- Rollback for 20261068100000_school_aimed_sponsored.sql. Puts challenge_my_audiences and challenge_set_audience back exactly as 20261027100000 defined them
-- and drops the three new functions. The verification columns on public.institutions and the flags.sponsor_school_aiming row are left in place (inert), so no
-- record of which schools were verified is lost. Campaigns already aimed at a school keep their audience.
begin;

create or replace function public.challenge_my_audiences() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.class_name) order by k.class_name) from public.classes k
                          where lower(k.status::text) = 'active' and (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id))), '[]'::jsonb),
    'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.institutions i
                               where public.qb_challenge_school_admin(i.id)), '[]'::jsonb));
$fn$;

create or replace function public.challenge_set_audience(p_id uuid, p_class uuid default null, p_institution uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k public.classes;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_class is not null and p_institution is not null then raise exception 'INVALID_AUDIENCE' using errcode = '22023'; end if;
  if p_class is not null then
    select * into k from public.classes where id = p_class;
    if not found or not (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;
  if p_institution is not null and not (public.qb_challenge_school_admin(p_institution) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.challenge_campaigns set audience_class_id = p_class, audience_institution_id = p_institution,
         visibility = case when (p_class is not null or p_institution is not null) and visibility = 'PUBLIC' then 'UNLISTED' else visibility end, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_audience_set', p_id, jsonb_build_object('class', p_class, 'institution', p_institution));
  return jsonb_build_object('ok', true);
end $fn$;

drop function if exists public.institution_set_verified(uuid, boolean, text);
drop function if exists public.qb_school_verifier();
drop function if exists public.qb_school_aiming_on();

notify pgrst, 'reload schema';
commit;
