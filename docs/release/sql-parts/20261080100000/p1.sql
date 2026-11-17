-- Family workspace, phase 2: add a child, link an existing student, and give a child a single-use way in.
--   public.qb_family_child_provision(...)       service role only: builds the student profile for a child the parent creates and links it to the parent's workspace
--   public.qb_family_invite_issue(student)      the parent gets a one-time link token (also used to resend); earlier unused links stop working; only a hash is stored
--   public.qb_family_invite_peek(token)         service role only: is this link valid, and the child's first name (does not use it up)
--   public.qb_family_invite_consume(token)      service role only: uses the link up exactly once (a second use, an expired or revoked link all fail)
--   public.qb_family_invite_revoke(student)     the parent cancels the unused link
--   public.qb_family_link_request(email)        the parent asks to link an EXISTING student by email; the answer is always the same, so nobody can find out who has an account
--   public.qb_family_my_requests() / qb_family_link_respond(id, accept)   the student sees who asked and accepts or declines; nothing is shared with the parent until they accept
-- A child under 13 keeps every existing protection (managed_by is the parent, is_minor is true). The child is an ordinary student: no new identity type.
-- A link waiting for the student's answer shows the parent only the email they typed, never the student's name or class.
-- Off with the rest of the family workspace (flags.family_workspace). Additive and idempotent. Rollback: supabase/rollback/family_children.sql


alter table public.account_relationships add column if not exists label text;

create table if not exists public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.family_workspaces(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists family_invitations_student on public.family_invitations(student_user_id, status);
alter table public.family_invitations enable row level security;
revoke all on public.family_invitations from public, anon, authenticated;

create or replace function quizbox_core.family_token_hash(p_token text) returns text
language sql immutable set search_path = '' as $fn$ select encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') $fn$;

create or replace function public.qb_family_child_provision(p_parent uuid, p_user uuid, p_first_name text, p_last_name text, p_display_name text, p_age integer, p_grade_code text, p_school text, p_username text, p_consent_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare par public.profiles; cfg jsonb; g jsonb; v_level text; v_grade text; first text := btrim(coalesce(p_first_name, '')); lastn text := nullif(btrim(coalesce(p_last_name, '')), '');
  shown text; mkt uuid; minor boolean; att jsonb; sp_id uuid; school text := nullif(left(btrim(coalesce(p_school, '')), 200), '');
begin
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED'; end if;
  select * into par from public.profiles where id = p_parent;
  if par.id is null or lower(par.role::text) = 'student' then raise exception 'QB_FAMILY_NOT_ADULT'; end if;
  if char_length(first) not between 2 and 40 or first !~ '^[A-Za-z][A-Za-z '' -]*$' then raise exception 'QB_FAMILY_NAME_INVALID'; end if;
  if lastn is not null and (char_length(lastn) > 40 or lastn !~ '^[A-Za-z][A-Za-z '' -]*$') then raise exception 'QB_FAMILY_NAME_INVALID'; end if;
  if p_username !~ '^[a-z][a-z0-9.]{3,30}$' then raise exception 'QB_FAMILY_USERNAME_INVALID'; end if;
  if p_age is null or p_age not between 3 and 30 then raise exception 'QB_FAMILY_AGE_INVALID'; end if;
  if char_length(btrim(coalesce(p_consent_ref, ''))) < 5 then raise exception 'QB_FAMILY_CONSENT_REQUIRED'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'AUTH_REQUIRED'; end if;
  mkt := coalesce(par.primary_market_id, par.default_market_id);
  select m.configuration into cfg from public.markets m where m.id = mkt;
  select x into g from jsonb_array_elements(coalesce(cfg -> 'grades', '[]')) x where x ->> 'code' = btrim(coalesce(p_grade_code, '')) limit 1;
  if g is null then raise exception 'QB_FAMILY_GRADE_INVALID'; end if;
  v_grade := g ->> 'code'; v_level := g ->> 'level';
  minor := p_age < 13;
  shown := coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), btrim(first || ' ' || coalesce(lastn, '')));
  insert into public.profiles(id, role, full_name, email, status, country, school_name, default_market_id, primary_market_id, onboarding_completed_at)
  values (p_user, 'student', left(shown, 80), (select email from auth.users where id = p_user), 'active', coalesce(par.country, 'Ghana'), school, mkt, mkt, now())
  on conflict (id) do update set role = 'student', full_name = excluded.full_name, status = 'active', country = excluded.country, school_name = excluded.school_name,
      default_market_id = excluded.default_market_id, primary_market_id = excluded.primary_market_id, onboarding_completed_at = excluded.onboarding_completed_at;
  insert into public.student_profiles(user_id, grade, grade_code, education_level, school_name, country, status, managed_by, is_minor)
  values (p_user, case when exists (select 1 from pg_enum where enumtypid = 'public.qb_grade'::regtype and enumlabel = v_grade) then v_grade::public.qb_grade else null end,
          v_grade, v_level, school, coalesce(par.country, 'Ghana'), 'active', case when minor then p_parent else null end, minor)
  on conflict (user_id) do update set grade_code = excluded.grade_code, education_level = excluded.education_level, school_name = excluded.school_name, status = 'active',
      managed_by = excluded.managed_by, is_minor = excluded.is_minor, archived_at = null
  returning id into sp_id;
  if mkt is not null then insert into public.user_market_memberships(user_id, market_id, active) values (p_user, mkt, true) on conflict (user_id, market_id) do update set active = true; end if;
  insert into public.learner_consent(user_id, status, policy_ref, decided_by, decided_at)
  values (p_user, 'granted', 'parent-attested: ' || left(btrim(p_consent_ref), 120), p_parent, now())
  on conflict (user_id) do update set status = 'granted', policy_ref = excluded.policy_ref, decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();
  att := public.qb_family_attach_child(p_parent, p_user, 'parent');
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (p_parent, 'family.child_create', 'profiles', p_user, 'pass', jsonb_build_object('username', p_username, 'minor', minor, 'workspace', att ->> 'workspace_id'));
  return jsonb_build_object('user_id', p_user, 'student_id', sp_id, 'username', p_username, 'first_name', first, 'is_minor', minor);
end $fn$;

create or replace function public.qb_family_invite_issue(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; tok text; exp timestamptz := now() + interval '7 days'; inv uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not quizbox_core.family_can(uid, p_student, 'manage_access') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  update public.family_invitations set status = 'revoked' where student_user_id = p_student and status = 'pending';
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.family_invitations(workspace_id, student_user_id, token_hash, expires_at, created_by)
  values (w, p_student, quizbox_core.family_token_hash(tok), exp, uid) returning id into inv;
  perform quizbox_core.audit('family.invite_issue', 'family_invitations', inv, jsonb_build_object('student', p_student));
  return jsonb_build_object('token', tok, 'expires_at', exp);
end $fn$;
