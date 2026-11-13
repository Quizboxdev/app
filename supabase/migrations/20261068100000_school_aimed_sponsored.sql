-- QuizBox sponsored school pilot: QuizBox staff can aim a challenge (for example a sponsor's) at ONE verified school.
-- Ships OFF behind flags.sponsor_school_aiming. Flag off: challenge_my_audiences and challenge_set_audience behave exactly as before.
-- Flag on: (1) a platform administrator (owner or admin role, or the super_admin / campaign_admin capability) is also offered every active school and
-- its classes; (2) a school or a class of a school can be chosen by staff only after the school has been marked verified. The evidence (for example the
-- school's GES / EMIS number and a signed letter) is held by QuizBox staff OFF the system; verification_note only points to it and never holds personal data.
-- School administrators aiming at their own school and teachers aiming at their own class are unaffected. Sponsors cannot pick a school. Managed under-13
-- learners stay excluded (qb_challenge_active_user is unchanged). Builds on 20261027100000. Additive and idempotent. Rollback: supabase/rollback/school_aimed_sponsored.sql.
begin;

-- 1. The verification record on a school.
alter table public.institutions
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verification_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'institutions_verification_note_len') then
    alter table public.institutions add constraint institutions_verification_note_len check (verification_note is null or length(verification_note) <= 300);
  end if;
end $$;

-- 2. The flag, off.
insert into public.platform_settings(key, value, description)
  select 'flags.sponsor_school_aiming', 'false', 'Staff may aim a sponsored challenge at one verified school'
  where not exists (select 1 from public.platform_settings where key = 'flags.sponsor_school_aiming' and scope_type = 'global');

create or replace function public.qb_school_aiming_on() returns boolean language sql stable security definer set search_path = '' as $fn$
  select quizbox_core.flag('flags.sponsor_school_aiming');
$fn$;
revoke all on function public.qb_school_aiming_on() from public, anon, authenticated;

-- Owner / admin role or super admin only: the stricter test used to mark a school verified (campaign admins can aim but cannot verify).
create or replace function public.qb_school_verifier() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user() and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('owner','admin'))
    or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability = 'super_admin'));
$fn$;
revoke all on function public.qb_school_verifier() from public, anon, authenticated;

-- 3. Staff mark a school verified (a note pointing to the off-system evidence is required) or remove the mark.
create or replace function public.institution_set_verified(p_institution uuid, p_verified boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare n text := nullif(btrim(p_note), '');
begin
  if not public.qb_school_verifier() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if not exists (select 1 from public.institutions where id = p_institution) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_verified and n is null then raise exception 'VERIFICATION_NOTE_REQUIRED' using errcode = '22023'; end if;
  if n is not null and length(n) > 300 then raise exception 'VERIFICATION_NOTE_TOO_LONG' using errcode = '22023'; end if;
  update public.institutions
     set verified_at = case when p_verified then now() else null end,
         verified_by = case when p_verified then auth.uid() else null end,
         verification_note = case when p_verified then n else null end,
         updated_at = now()
   where id = p_institution;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
    values (auth.uid(), case when p_verified then 'institution_verified' else 'institution_unverified' end, 'institution', p_institution, 'ok', jsonb_build_object('verified', p_verified));
  return jsonb_build_object('ok', true, 'verified', p_verified);
end $fn$;
revoke all on function public.institution_set_verified(uuid, boolean, text) from public, anon;
grant execute on function public.institution_set_verified(uuid, boolean, text) to authenticated;

-- 4. The classes and schools this person may aim a campaign at. Flag off or not an administrator: exactly as before.
create or replace function public.challenge_my_audiences() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when public.qb_school_aiming_on() and public.qb_challenge_admin() then
    jsonb_build_object(
      'classes', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', i.name || ' · ' || k.class_name) order by i.name, k.class_name)
                             from public.classes k join public.institutions i on i.id = k.institution_id
                            where lower(k.status::text) = 'active' and lower(i.status::text) = 'active' and i.verified_at is not null), '[]'::jsonb),
      'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'verified', i.verified_at is not null) order by i.name)
                                  from public.institutions i where lower(i.status::text) = 'active'), '[]'::jsonb))
  else
    jsonb_build_object(
      'classes', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.class_name) order by k.class_name) from public.classes k
                            where lower(k.status::text) = 'active' and (k.teacher_user_id = auth.uid() or public.qb_challenge_school_admin(k.institution_id))), '[]'::jsonb),
      'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.institutions i
                                 where public.qb_challenge_school_admin(i.id)), '[]'::jsonb))
  end;
$fn$;

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
commit;
