-- 5. Setting the audience. Flag on: a platform administrator who is neither the class's teacher nor the school's administrator may only choose a verified school.
create or replace function public.challenge_set_audience(p_id uuid, p_class uuid default null, p_institution uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k public.classes; guard boolean := public.qb_school_aiming_on();
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_class is not null and p_institution is not null then raise exception 'INVALID_AUDIENCE' using errcode = '22023'; end if;
  if p_class is not null then
    select * into k from public.classes where id = p_class;
    if not found or not (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
    if guard and k.institution_id is not null and not (coalesce(k.teacher_user_id = auth.uid(), false) or public.qb_challenge_school_admin(k.institution_id))
       and not exists (select 1 from public.institutions i where i.id = k.institution_id and i.verified_at is not null) then
      raise exception 'SCHOOL_NOT_VERIFIED' using errcode = '55000';
    end if;
  end if;
  if p_institution is not null and not (public.qb_challenge_school_admin(p_institution) or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if guard and p_institution is not null and not public.qb_challenge_school_admin(p_institution)
     and not exists (select 1 from public.institutions i where i.id = p_institution and i.verified_at is not null) then
    raise exception 'SCHOOL_NOT_VERIFIED' using errcode = '55000';
  end if;
  update public.challenge_campaigns set audience_class_id = p_class, audience_institution_id = p_institution,
         visibility = case when (p_class is not null or p_institution is not null) and visibility = 'PUBLIC' then 'UNLISTED' else visibility end, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_audience_set', p_id, jsonb_build_object('class', p_class, 'institution', p_institution));
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.challenge_my_audiences(), public.challenge_set_audience(uuid, uuid, uuid) from public, anon;
grant execute on function public.challenge_my_audiences(), public.challenge_set_audience(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
