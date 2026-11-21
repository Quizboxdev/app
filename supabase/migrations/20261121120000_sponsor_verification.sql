-- Sponsor verification: a sponsor sees whether their organisation has been verified, and a super administrator has a queue to verify or decline, with a reason a decline must carry.
-- Only organisations are verified here: parents and individuals have their own checks (the family link and guardian approval), and alumni their own application.
-- The status column already exists (PENDING by default); this adds who decided, when and why, plus the queue and the decision. Nothing is blocked by it yet: it is shown, not enforced.
alter table public.sponsor_profiles add column if not exists verification_note text;
alter table public.sponsor_profiles add column if not exists verified_at timestamptz;
alter table public.sponsor_profiles add column if not exists verified_by uuid references public.profiles(id) on delete set null;

create or replace function public.qb_admin_sponsor_queue(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare want text := upper(coalesce(nullif(btrim(p_status), ''), 'PENDING'));
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if want not in ('PENDING', 'VERIFIED', 'REJECTED', 'ALL') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'organization_name', s.organization_name, 'sponsor_type', s.sponsor_type, 'contact_name', s.contact_name,
      'email', p.email, 'website', s.website, 'country', s.country, 'status', s.status, 'verification_status', upper(s.verification_status), 'verification_note', s.verification_note,
      'verified_at', s.verified_at, 'created_at', s.created_at) order by s.created_at desc)
    from (select * from public.sponsor_profiles where upper(coalesce(sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION' and (want = 'ALL' or upper(verification_status) = want) order by created_at desc limit 300) s
    left join public.profiles p on p.id = s.user_id), '[]'::jsonb);
end $fn$;

create or replace function public.qb_admin_sponsor_decide(p_sponsor uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare d text := upper(btrim(coalesce(p_decision, ''))); n text := nullif(btrim(coalesce(p_note, '')), ''); s public.sponsor_profiles;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if d not in ('VERIFIED', 'REJECTED', 'PENDING') then raise exception 'INVALID_DECISION' using errcode = '22023'; end if;
  if d = 'REJECTED' and (n is null or char_length(n) < 10) then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if n is not null and char_length(n) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = '22023'; end if;
  update public.sponsor_profiles set verification_status = d, verification_note = case when d = 'VERIFIED' then null else n end,
         verified_at = case when d = 'VERIFIED' then now() else null end, verified_by = case when d = 'VERIFIED' then auth.uid() else null end, updated_at = now()
   where id = p_sponsor returning * into s;
  if s.id is null then raise exception 'SPONSOR_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('sponsor.verification', 'sponsor_profiles', s.id, jsonb_build_object('decision', d));
  if d <> 'PENDING' then
    insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
    values (s.user_id, 'sponsor', 'sponsor_verification',
      case when d = 'VERIFIED' then 'Your organisation is verified' else 'We could not verify your organisation' end,
      case when d = 'VERIFIED' then 'Thank you. QuizBox has verified your organisation.' else 'Open your sponsor dashboard to see why, or contact QuizBox.' end,
      'sponsor_profiles', s.id);
  end if;
  return jsonb_build_object('id', s.id, 'verification_status', d);
end $fn$;

revoke all on function public.qb_admin_sponsor_queue(text), public.qb_admin_sponsor_decide(uuid, text, text) from public, anon;
grant execute on function public.qb_admin_sponsor_queue(text), public.qb_admin_sponsor_decide(uuid, text, text) to authenticated;
