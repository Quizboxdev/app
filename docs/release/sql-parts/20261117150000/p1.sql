-- Alumni sponsors apply for approval to create a family and add selected students.
-- An ALUMNI sponsor (sponsor_type ALUMNI, set at sign-up) cannot open a family workspace until an application is approved. Competitions by
-- invitation need no approval. Approved by QuizBox staff (staff or super admin) or by an administrator of the named school (an institution that matches by name).
-- Parents and organizations are not affected. The guard is a trigger on family_workspaces, so every way of opening a workspace is covered.
-- Rollback: supabase/rollback/family_alumni_applications.sql

create table if not exists public.sponsor_family_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references public.profiles(id) on delete cascade,
  school_name text not null check (char_length(btrim(school_name)) between 2 and 200),
  institution_id uuid references public.institutions(id) on delete set null,
  alumni_note text not null check (char_length(btrim(alumni_note)) between 10 and 1500),
  intended_students text not null check (char_length(btrim(intended_students)) between 10 and 1500),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'declined')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now()
);
create unique index if not exists sponsor_family_applications_open on public.sponsor_family_applications(applicant_user_id) where status in ('submitted', 'approved');
alter table public.sponsor_family_applications enable row level security;
revoke all on public.sponsor_family_applications from anon, authenticated;

create or replace function quizbox_core.family_creation_allowed(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select not exists (select 1 from public.sponsor_profiles sp where sp.user_id = p_user and upper(sp.sponsor_type) = 'ALUMNI')
      or exists (select 1 from public.sponsor_family_applications a where a.applicant_user_id = p_user and a.status = 'approved');
$fn$;

create or replace function quizbox_core.family_workspace_guard() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if not quizbox_core.family_creation_allowed(new.owner_user_id) then raise exception 'QB_FAMILY_APPROVAL_REQUIRED' using errcode = '42501'; end if;
  return new;
end $fn$;
drop trigger if exists family_workspace_guard on public.family_workspaces;
create trigger family_workspace_guard before insert on public.family_workspaces for each row execute function quizbox_core.family_workspace_guard();

create or replace function public.qb_family_apply(p_school text, p_note text, p_students text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); typ text; inst uuid; aid uuid; school text := btrim(coalesce(p_school, ''));
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select upper(sponsor_type) into typ from public.sponsor_profiles where user_id = uid;
  if typ is distinct from 'ALUMNI' then raise exception 'QB_FAMILY_APPLICATION_NOT_NEEDED' using errcode = '42501'; end if;
  if char_length(school) < 2 or char_length(btrim(coalesce(p_note, ''))) < 10 or char_length(btrim(coalesce(p_students, ''))) < 10 then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  if exists (select 1 from public.sponsor_family_applications where applicant_user_id = uid and status in ('submitted', 'approved')) then raise exception 'QB_FAMILY_APPLICATION_EXISTS' using errcode = '23505'; end if;
  select i.id into inst from public.institutions i where lower(btrim(i.name)) = lower(school) and i.status::text = 'active' limit 1;
  insert into public.sponsor_family_applications(applicant_user_id, school_name, institution_id, alumni_note, intended_students)
  values (uid, left(school, 200), inst, left(btrim(p_note), 1500), left(btrim(p_students), 1500)) returning id into aid;
  perform quizbox_core.audit('family.alumni_apply', 'sponsor_family_applications', aid, jsonb_build_object('matched_school', inst is not null));
  return jsonb_build_object('id', aid, 'matched_school', inst is not null);
end $fn$;

create or replace function public.qb_family_my_application() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); typ text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select upper(sponsor_type) into typ from public.sponsor_profiles where user_id = uid;
  return jsonb_build_object('required', coalesce(typ = 'ALUMNI', false),
    'application', (select jsonb_build_object('id', a.id, 'status', a.status, 'school_name', a.school_name, 'decision_note', a.decision_note, 'created_at', a.created_at)
                      from public.sponsor_family_applications a where a.applicant_user_id = uid order by a.created_at desc limit 1));
end $fn$;

-- Approvers see waiting applications: staff and super admin see all of them; a school administrator sees those for their own school.
create or replace function public.qb_family_applications_pending() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); is_staff boolean;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  is_staff := quizbox_core.is_staff() or quizbox_market.is_super();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'applicant_name', coalesce(nullif(sp.organization_name, ''), nullif(p.full_name, ''), 'An alumni sponsor'), 'applicant_email', p.email,
      'school_name', a.school_name, 'matched_school', a.institution_id is not null, 'alumni_note', a.alumni_note, 'intended_students', a.intended_students, 'created_at', a.created_at) order by a.created_at)
    from public.sponsor_family_applications a
    join public.profiles p on p.id = a.applicant_user_id
    left join public.sponsor_profiles sp on sp.user_id = a.applicant_user_id
    where a.status = 'submitted' and (is_staff or (a.institution_id is not null and quizbox_ops.school_admin(a.institution_id)))), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_application_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); a public.sponsor_family_applications;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into a from public.sponsor_family_applications where id = p_id and status = 'submitted' for update;
  if a.id is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  if not (quizbox_core.is_staff() or quizbox_market.is_super() or (a.institution_id is not null and quizbox_ops.school_admin(a.institution_id))) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  update public.sponsor_family_applications set status = case when coalesce(p_approve, false) then 'approved' else 'declined' end, decided_by = uid, decided_at = now(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '') where id = a.id;
  insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
  select a.applicant_user_id, ap.role, 'family_application_response', 'Family application ' || case when coalesce(p_approve, false) then 'approved' else 'declined' end,
    case when coalesce(p_approve, false) then 'Your application was approved. Open your Family workspace to add selected students.' else 'Your application was declined.' end, 'sponsor_family_applications', a.id
    from public.profiles ap where ap.id = a.applicant_user_id;
  perform quizbox_core.audit('family.alumni_decide', 'sponsor_family_applications', a.id, jsonb_build_object('approved', coalesce(p_approve, false)));
  return jsonb_build_object('approved', coalesce(p_approve, false));
end $fn$;

revoke all on function public.qb_family_apply(text, text, text), public.qb_family_my_application(), public.qb_family_applications_pending(), public.qb_family_application_decide(uuid, boolean, text) from public, anon;
grant execute on function public.qb_family_apply(text, text, text), public.qb_family_my_application(), public.qb_family_applications_pending(), public.qb_family_application_decide(uuid, boolean, text) to authenticated;
revoke all on function quizbox_core.family_creation_allowed(uuid), quizbox_core.family_workspace_guard() from public, anon, authenticated;
