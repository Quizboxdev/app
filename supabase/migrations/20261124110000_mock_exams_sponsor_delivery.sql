-- Mock exams, part 4 of 4: how a sponsor gives an exam to learners without selling it. Needs the three earlier mock-exam migrations (20261122100000, 110000, 120000).
--   family     A sponsor with a family workspace gives a published exam to the children they may assign work to (the same permission as assigning anything else). Free: the child gets their own private copy,
--              for 90 days, opened from "My mock exams". The sponsor can take it back (no new attempts; what was answered stays).
--   link       A verified ORGANIZATION or ALUMNI sponsor (a church, an alumni group, a company) shares an exam by link for a fixed number of places, and PAYS FOR THE PLACES UP FRONT with Coins from their
--              wallet (1 Coin per place, the same price as quiz seats). A person must sign in with a learner account to join; each join takes one place; when the places are used the link says it is full.
--              The sponsor can add places later (paying only the difference) or close the link. Places are not refunded when a link closes. Joiners are shown to the sponsor as "Joiner 1, 2, ..." without names.
-- Both deliver the exact published version through the same private-copy and attempt engine as a Marketplace purchase (nothing is rebuilt). Anyone can take an exam only while their copy is allowed
-- (a live purchase, or a live gift), checked again when an attempt starts.
-- Authors widen a little: verified ALUMNI sponsors, and parents / alumni with a family workspace, may now build exams (to give to their family). Only verified ORGANIZATION or ALUMNI sponsors may share by link;
-- only teachers and verified ORGANIZATION sponsors may sell.
-- Off: gifts to a family follow flags.mock_exams and flags.family_workspace; links need the new flags.mock_exam_links (false). Additive: two tables, two columns, new functions; author_kind, entitled and attempt_rows are
-- replaced with the earlier behaviour plus the above (the rollback puts them back).
-- Errors: QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_MOCK_NOT_PUBLISHED, QB_MOCK_ARCHIVED, QB_MOCK_VERSION_STALE, QB_MOCK_LINK_SPONSORS_ONLY, QB_MOCK_LINK_INVALID, QB_MOCK_LINK_NOT_FOUND, QB_MOCK_LINK_CLOSED,
--   QB_MOCK_LINK_FULL, QB_MOCK_OWN_EXAM, QB_MOCK_JOIN_NOT_ALLOWED, QB_STUDENT_REQUIRED, QB_MOCK_ENTITLEMENT_REQUIRED, QB_NOT_FOUND, QB_INSUFFICIENT_BALANCE (from the wallet).
-- Rollback: supabase/rollback/mock_exams_sponsor_delivery.sql (keeps the tables, the gifts and the places already paid for).
begin;

insert into public.platform_settings(key, value, description)
select v.key, v.value::jsonb, v.descr from (values
  ('flags.mock_exam_links', 'false', 'Sponsors share a mock exam by link for a number of places they pay for in Coins'),
  ('mock_exams.coins_per_seat', '1', 'Coins one place on a shared mock exam costs'),
  ('mock_exams.max_link_seats', '1000', 'Most places on one shared link'),
  ('mock_exams.access_days', '90', 'Days a learner can use a mock exam they were given or joined')) as v(key, value, descr)
where not exists (select 1 from public.platform_settings p where p.key = v.key and p.scope_type = 'global');

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.mock_exam_links (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete restrict,
  version_id uuid not null references public.mock_exam_versions(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  code text not null unique check (code ~ '^[a-z0-9]{10}$'),
  seats_paid integer not null check (seats_paid between 1 and 100000),
  coins_paid integer not null default 0 check (coins_paid >= 0),
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mock_exam_links_exam on public.mock_exam_links(exam_id, created_at desc);

-- One row per learner who was given an exam (family) or joined one by link. The private copy is the enrolment row that points back here.
create table if not exists public.mock_exam_grants (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete restrict,
  version_id uuid not null references public.mock_exam_versions(id) on delete restrict,
  kind text not null check (kind in ('family', 'link')),
  granted_by uuid not null references public.profiles(id) on delete restrict,
  link_id uuid references public.mock_exam_links(id) on delete restrict,
  student_user_id uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  check ((kind = 'link') = (link_id is not null))
);
create unique index if not exists mock_exam_grants_one_join on public.mock_exam_grants(link_id, student_user_id) where link_id is not null;
create unique index if not exists mock_exam_grants_one_gift on public.mock_exam_grants(version_id, student_user_id, granted_by) where kind = 'family' and status = 'active';
create index if not exists mock_exam_grants_student on public.mock_exam_grants(student_user_id, created_at desc);
create index if not exists mock_exam_grants_exam on public.mock_exam_grants(exam_id, created_at);
alter table public.mock_exam_links enable row level security; alter table public.mock_exam_grants enable row level security;
revoke all on public.mock_exam_links, public.mock_exam_grants from anon, authenticated;

alter table public.mock_exam_enrolments alter column purchase_id drop not null;
alter table public.mock_exam_enrolments add column if not exists grant_id uuid unique references public.mock_exam_grants(id) on delete restrict;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'mock_exam_enrolments_one_source') then
    alter table public.mock_exam_enrolments add constraint mock_exam_enrolments_one_source check ((purchase_id is null) <> (grant_id is null));
  end if;
end $c$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- A verified ORGANIZATION or ALUMNI sponsor: may share by link.
create or replace function quizbox_mock.link_sponsor(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.profiles p join public.sponsor_profiles s on s.user_id = p.id
                  where p.id = p_user and upper(p.role::text) = 'SPONSOR' and lower(p.status::text) = 'active'
                    and upper(coalesce(s.sponsor_type, 'ORGANIZATION')) in ('ORGANIZATION', 'ALUMNI') and upper(coalesce(s.verification_status, '')) = 'VERIFIED' and lower(coalesce(s.status::text, 'active')) = 'active')
$fn$;

-- Who may author: an active teacher, staff, a verified ORGANIZATION or ALUMNI sponsor, or a sponsor (parent, alumni) who has a family workspace while that workspace is open.
create or replace function quizbox_mock.author_kind() returns text language plpgsql stable security definer set search_path = '' as $fn$
declare r text; st text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select upper(p.role::text), lower(p.status::text) into r, st from public.profiles p where p.id = auth.uid();
  if st is distinct from 'active' then raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501'; end if;
  if r = 'TEACHER' then return 'teacher'; end if;
  if r in ('ADMIN', 'OWNER') then return 'staff'; end if;
  if r = 'SPONSOR' then
    if quizbox_mock.link_sponsor(auth.uid()) then return 'sponsor'; end if;
    if coalesce(quizbox_core.flag('flags.family_workspace'), false) and exists (select 1 from public.family_workspaces w where w.owner_user_id = auth.uid())
       and exists (select 1 from public.sponsor_profiles s where s.user_id = auth.uid() and lower(coalesce(s.status::text, 'active')) = 'active') then return 'sponsor'; end if;
    raise exception 'QB_MOCK_SPONSOR_NOT_VERIFIED' using errcode = '42501';
  end if;
  raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501';
end $fn$;

-- May this person use this copy right now: a live purchase, or a live gift (family or link).
create or replace function quizbox_mock.entitled(p_assessment uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.mock_exam_enrolments en join public.mk_purchases p on p.id = en.purchase_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and p.buyer_user_id = p_user and p.status = 'active' and p.expires_at > now())
      or exists (select 1 from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and g.student_user_id = p_user and g.status = 'active' and g.expires_at > now())
$fn$;

-- Opens the private copy for a gift or a join, once.
create or replace function quizbox_mock.ensure_grant_enrolment(p_grant uuid) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare g public.mock_exam_grants; en public.mock_exam_enrolments; a_id uuid;
begin
  select * into g from public.mock_exam_grants where id = p_grant for update;
  if g.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into en from public.mock_exam_enrolments where grant_id = g.id;
  if en.id is not null then return en.id; end if;
  a_id := quizbox_mock.open_copy(g.version_id, g.student_user_id, g.expires_at);
  insert into public.mock_exam_enrolments(exam_id, version_id, student_user_id, purchase_id, grant_id, assessment_id) values (g.exam_id, g.version_id, g.student_user_id, null, g.id, a_id) returning * into en;
  update public.assessments set reference_id = en.id where id = a_id;
  return en.id;
end $fn$;

-- Every attempt the owner may see: class attempts (with names), gifts to the family (with names), joiners by link ("Joiner N", no identity) and Marketplace buyers ("Buyer N").
create or replace function quizbox_mock.attempt_rows(p_exam uuid) returns table(attempt_id uuid, source text, group_label text, class_id uuid, participant_key uuid, participant text, attempt_no integer, state text,
  started_at timestamptz, submitted_at timestamptz, score numeric, total_marks numeric, percentage numeric, assessment_id uuid, version_id uuid)
language sql stable security definer set search_path = '' as $fn$
  select a.id, 'class'::text, c.class_name, x.class_id, a.student_user_id, coalesce(p.full_name, 'Learner'),
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, ma.version_id
    from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.attempts a on a.assignment_id = x.id
    join public.classes c on c.id = x.class_id left join public.profiles p on p.id = a.student_user_id
   where ma.exam_id = p_exam and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))
  union all
  select a.id, 'market'::text, 'Marketplace', null::uuid, a.student_user_id, 'Buyer ' || (dense_rank() over (order by en.created_at, en.id))::text,
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.attempts a on a.assessment_id = en.assessment_id
   where en.exam_id = p_exam and en.purchase_id is not null
  union all
  select a.id, 'family'::text, 'Family', null::uuid, a.student_user_id, coalesce(p.full_name, 'Learner'),
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id and g.kind = 'family' and g.granted_by = auth.uid()
    join public.attempts a on a.assessment_id = en.assessment_id left join public.profiles p on p.id = a.student_user_id
   where en.exam_id = p_exam
  union all
  select a.id, 'link'::text, 'Shared link', null::uuid, a.student_user_id, 'Joiner ' || (dense_rank() over (order by en.created_at, en.id))::text,
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id and g.kind = 'link'
    join public.attempts a on a.assessment_id = en.assessment_id
   where en.exam_id = p_exam
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Family: give an exam to the children the sponsor may assign work to
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_family_give(p_exam uuid, p_students uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); e public.mock_exams := quizbox_mock.own_exam(p_exam, true); v public.mock_exam_versions; sid uuid; g public.mock_exam_grants; n integer := 0; v_stale integer; v_name text;
  v_days integer := quizbox_mock.num('mock_exams.access_days', 90)::integer;
begin
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  if p_students is null or cardinality(p_students) not between 1 and 20 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  foreach sid in array p_students loop
    if not quizbox_core.family_can(uid, sid, 'assign') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  end loop;
  select * into v from public.mock_exam_versions where id = e.current_version_id;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select coalesce(nullif(full_name, ''), 'Your family') into v_name from public.profiles where id = uid;
  foreach sid in array p_students loop
    update public.mock_exam_grants set status = 'revoked' where kind = 'family' and version_id = v.id and student_user_id = sid and granted_by = uid and status = 'active' and expires_at <= now();
    if not exists (select 1 from public.mock_exam_grants where kind = 'family' and version_id = v.id and student_user_id = sid and granted_by = uid and status = 'active') then
      insert into public.mock_exam_grants(exam_id, version_id, kind, granted_by, student_user_id, expires_at) values (e.id, v.id, 'family', uid, sid, now() + make_interval(days => v_days)) returning * into g;
      perform quizbox_mock.ensure_grant_enrolment(g.id);
      begin
        insert into public.notifications(recipient_user_id, recipient_role, type, title, message)
        values (sid, 'student', 'mock_exam_gift', 'A mock exam from ' || v_name, v_name || ' gave you the mock exam "' || e.title || '". Find it under My mock exams.');
      exception when others then null;   -- a notice must never undo the gift
      end;
      n := n + 1;
    end if;
  end loop;
  perform quizbox_core.audit('mock_exam.family_give', 'mock_exams', e.id, jsonb_build_object('version', v.version_no, 'children', n));
  return jsonb_build_object('given', n, 'already', cardinality(p_students) - n, 'version_no', v.version_no, 'days', v_days);
end $fn$;

create or replace function public.qb_mock_family_revoke(p_exam uuid, p_student uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); n integer;
begin
  update public.mock_exam_grants set status = 'revoked' where exam_id = e.id and kind = 'family' and granted_by = auth.uid() and student_user_id = p_student and status = 'active';
  get diagnostics n = row_count;
  perform quizbox_core.audit('mock_exam.family_revoke', 'mock_exams', e.id, jsonb_build_object('revoked', n));
  return jsonb_build_object('revoked', n);
end $fn$;

-- Who in the family already has this exam, with how far they got.
create or replace function public.qb_mock_family_given(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'student_id', g.student_user_id, 'name', coalesce(p.full_name, 'Learner'), 'version_no', v.version_no, 'expires_at', g.expires_at,
      'active', g.status = 'active' and g.expires_at > now(), 'status', g.status, 'attempts_used', (select count(*) from public.attempts a where a.assessment_id = en.assessment_id),
      'last_percent', (select a.percentage from public.attempts a where a.assessment_id = en.assessment_id and a.status::text = 'submitted' order by a.submitted_at desc limit 1)) order by g.created_at desc)
    from public.mock_exam_grants g join public.mock_exam_versions v on v.id = g.version_id left join public.profiles p on p.id = g.student_user_id left join public.mock_exam_enrolments en on en.grant_id = g.id
   where g.exam_id = e.id and g.kind = 'family' and g.granted_by = auth.uid()), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Shared link with paid places
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.link_owner(p_exam uuid) returns public.mock_exams language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if not coalesce(quizbox_core.flag('flags.mock_exam_links'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if not quizbox_mock.link_sponsor(auth.uid()) then raise exception 'QB_MOCK_LINK_SPONSORS_ONLY' using errcode = '42501'; end if;
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  return e;
end $fn$;

create or replace function quizbox_mock.link_json(l public.mock_exam_links) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', l.id, 'code', l.code, 'path', '/mock-exams/join/' || l.code, 'version_no', v.version_no, 'seats_paid', l.seats_paid, 'coins_paid', l.coins_paid,
    'joined', (select count(*) from public.mock_exam_grants g where g.link_id = l.id), 'closes_at', l.closes_at, 'status', case when l.status = 'closed' then 'closed' when l.closes_at <= now() then 'ended' else 'open' end,
    'behind_current', e.current_version_id is distinct from l.version_id, 'created_at', l.created_at,
    'attempts', (select count(*) from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id join public.attempts a on a.assessment_id = en.assessment_id where g.link_id = l.id))
    from public.mock_exam_versions v join public.mock_exams e on e.id = v.exam_id where v.id = l.version_id
$fn$;

create or replace function public.qb_mock_link_create(p_exam uuid, p_seats integer, p_closes_at timestamptz default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.link_owner(p_exam); l public.mock_exam_links; v_max integer := quizbox_mock.num('mock_exams.max_link_seats', 1000)::integer; v_per numeric := quizbox_mock.num('mock_exams.coins_per_seat', 1);
  v_cost integer; v_close timestamptz := coalesce(p_closes_at, now() + interval '90 days'); v_stale integer; v_code text;
begin
  if p_seats is null or p_seats < 1 or p_seats > v_max then raise exception 'QB_MOCK_LINK_INVALID' using errcode = '22023'; end if;
  if v_close <= now() or v_close > now() + interval '365 days' then raise exception 'QB_MOCK_LINK_INVALID' using errcode = '22023'; end if;
  v_stale := quizbox_mock.stale(e.current_version_id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since this version was published', v_stale using errcode = '55000'; end if;
  v_cost := ceil(p_seats * v_per)::integer;
  loop v_code := substr(md5(random()::text || clock_timestamp()::text || e.id::text), 1, 10); exit when not exists (select 1 from public.mock_exam_links where code = v_code); end loop;
  insert into public.mock_exam_links(exam_id, version_id, owner_user_id, code, seats_paid, coins_paid, closes_at) values (e.id, e.current_version_id, auth.uid(), v_code, p_seats, v_cost, v_close) returning * into l;
  perform public.qb_coin_spend(auth.uid(), v_cost, 'mock exam places', l.id::text, 'mocklink-' || l.id::text || '-0-' || p_seats::text);
  perform quizbox_core.audit('mock_exam.link_create', 'mock_exams', e.id, jsonb_build_object('link', l.id, 'seats', p_seats, 'coins', v_cost));
  return quizbox_mock.link_json(l);
end $fn$;

-- Add places: the total number of places wanted; only the difference is paid.
create or replace function public.qb_mock_link_add_seats(p_link uuid, p_total integer) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare l public.mock_exam_links; e public.mock_exams; v_max integer := quizbox_mock.num('mock_exams.max_link_seats', 1000)::integer; v_per numeric := quizbox_mock.num('mock_exams.coins_per_seat', 1); v_cost integer;
begin
  select * into l from public.mock_exam_links where id = p_link and owner_user_id = auth.uid() for update;
  if l.id is null then raise exception 'QB_MOCK_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  e := quizbox_mock.link_owner(l.exam_id);
  if l.status = 'closed' or l.closes_at <= now() then raise exception 'QB_MOCK_LINK_CLOSED' using errcode = '55000'; end if;
  if p_total is null or p_total <= l.seats_paid or p_total > v_max then raise exception 'QB_MOCK_LINK_INVALID' using errcode = '22023'; end if;
  v_cost := ceil(p_total * v_per)::integer - l.coins_paid;
  if v_cost > 0 then perform public.qb_coin_spend(auth.uid(), v_cost, 'mock exam places', l.id::text, 'mocklink-' || l.id::text || '-' || l.seats_paid::text || '-' || p_total::text); end if;
  update public.mock_exam_links set seats_paid = p_total, coins_paid = coins_paid + greatest(v_cost, 0), updated_at = now() where id = l.id returning * into l;
  perform quizbox_core.audit('mock_exam.link_seats', 'mock_exams', l.exam_id, jsonb_build_object('link', l.id, 'seats', p_total, 'coins', greatest(v_cost, 0)));
  return quizbox_mock.link_json(l);
end $fn$;

-- Close a link: nobody new can join. Places already paid for are not refunded. People who joined keep their copy until it expires.
create or replace function public.qb_mock_link_close(p_link uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare l public.mock_exam_links;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into l from public.mock_exam_links where id = p_link and owner_user_id = auth.uid() for update;
  if l.id is null then raise exception 'QB_MOCK_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.mock_exam_links set status = 'closed', updated_at = now() where id = l.id returning * into l;
  perform quizbox_core.audit('mock_exam.link_close', 'mock_exams', l.exam_id, jsonb_build_object('link', l.id));
  return quizbox_mock.link_json(l);
end $fn$;

create or replace function public.qb_mock_links(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, false);
begin
  return jsonb_build_object('enabled', coalesce(quizbox_core.flag('flags.mock_exam_links'), false), 'eligible', quizbox_mock.link_sponsor(auth.uid()), 'coins_per_seat', quizbox_mock.num('mock_exams.coins_per_seat', 1),
    'max_seats', quizbox_mock.num('mock_exams.max_link_seats', 1000), 'access_days', quizbox_mock.num('mock_exams.access_days', 90),
    'links', coalesce((select jsonb_agg(quizbox_mock.link_json(l) order by l.created_at desc) from public.mock_exam_links l where l.exam_id = e.id and l.owner_user_id = auth.uid()), '[]'::jsonb));
end $fn$;

-- What a person sees when they open a shared link (signed in). Never a question or an answer.
create or replace function public.qb_mock_link_info(p_code text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare l public.mock_exam_links; e public.mock_exams; v public.mock_exam_versions; n integer; v_open boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into l from public.mock_exam_links where code = lower(btrim(coalesce(p_code, '')));
  if l.id is null then return null; end if;
  select * into e from public.mock_exams where id = l.exam_id; select * into v from public.mock_exam_versions where id = l.version_id;
  select count(*) into n from public.mock_exam_grants where link_id = l.id;
  v_open := l.status = 'open' and l.closes_at > now() and e.status <> 'archived' and coalesce(quizbox_core.flag('flags.mock_exam_links'), false) and coalesce(quizbox_core.flag('flags.mock_exams'), false);
  return jsonb_build_object('title', e.title, 'description', e.description, 'purpose', e.purpose, 'from', coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = l.owner_user_id), 'A sponsor'),
    'target_grade', v.target_grade, 'question_count', v.question_count, 'total_marks', v.total_marks, 'time_limit_minutes', v.time_limit_minutes, 'attempts_allowed', v.attempts_allowed, 'access_days', quizbox_mock.num('mock_exams.access_days', 90),
    'open', v_open, 'full', n >= l.seats_paid, 'closes_at', l.closes_at, 'mine', l.owner_user_id = auth.uid(),
    'joined', exists (select 1 from public.mock_exam_grants g where g.link_id = l.id and g.student_user_id = auth.uid()));
end $fn$;

-- Join: takes one place, opens the person's own copy. Safe to repeat. A person already in keeps their place even when the link is full or closed.
create or replace function public.qb_mock_link_join(p_code text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); l public.mock_exam_links; e public.mock_exams; g public.mock_exam_grants; en_id uuid; n integer; v_days integer := quizbox_mock.num('mock_exams.access_days', 90)::integer;
begin
  if uid is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) or not coalesce(quizbox_core.flag('flags.mock_exam_links'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into l from public.mock_exam_links where code = lower(btrim(coalesce(p_code, ''))) for update;
  if l.id is null then raise exception 'QB_MOCK_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into g from public.mock_exam_grants where link_id = l.id and student_user_id = uid;
  if g.id is not null then
    en_id := quizbox_mock.ensure_grant_enrolment(g.id);
    return jsonb_build_object('ok', true, 'already', true, 'grant_id', g.id, 'expires_at', g.expires_at);
  end if;
  if l.owner_user_id = uid then raise exception 'QB_MOCK_OWN_EXAM' using errcode = '42501'; end if;
  if not public.qb_challenge_active_user() then raise exception 'QB_MOCK_JOIN_NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.student_profiles sp where sp.user_id = uid) then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  select * into e from public.mock_exams where id = l.exam_id;
  if l.status <> 'open' or l.closes_at <= now() or e.status = 'archived' then raise exception 'QB_MOCK_LINK_CLOSED' using errcode = '55000'; end if;
  select count(*) into n from public.mock_exam_grants where link_id = l.id;
  if n >= l.seats_paid then raise exception 'QB_MOCK_LINK_FULL' using errcode = '55000'; end if;
  insert into public.mock_exam_grants(exam_id, version_id, kind, granted_by, link_id, student_user_id, expires_at) values (l.exam_id, l.version_id, 'link', l.owner_user_id, l.id, uid, now() + make_interval(days => v_days)) returning * into g;
  en_id := quizbox_mock.ensure_grant_enrolment(g.id);     -- if a question changed since publishing this raises and the place is not taken
  return jsonb_build_object('ok', true, 'already', false, 'grant_id', g.id, 'expires_at', g.expires_at);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The learner's side: my gifts and joins, and starting one
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_my_grants() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'source', g.kind, 'title', e.title, 'from', coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = g.granted_by), 'A sponsor'),
      'expires_at', g.expires_at, 'active', g.status = 'active' and g.expires_at > now(), 'days_left', greatest(0, ceil(extract(epoch from (g.expires_at - now())) / 86400))::int, 'status', g.status,
      'version_no', v.version_no, 'question_count', v.question_count, 'time_limit_minutes', v.time_limit_minutes, 'attempts_allowed', v.attempts_allowed,
      'attempts_used', (select count(*) from public.attempts a where a.assessment_id = en.assessment_id),
      'in_progress_attempt', (select a.id from public.attempts a where a.assessment_id = en.assessment_id and a.status::text = 'in_progress' order by a.started_at desc limit 1),
      'last_attempt', (select jsonb_build_object('id', a.id, 'state', a.status::text, 'percent', a.percentage) from public.attempts a where a.assessment_id = en.assessment_id order by a.started_at desc limit 1)) order by g.created_at desc)
    from public.mock_exam_grants g join public.mock_exams e on e.id = g.exam_id join public.mock_exam_versions v on v.id = g.version_id left join public.mock_exam_enrolments en on en.grant_id = g.id
   where g.student_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_start_granted(p_grant uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare g public.mock_exam_grants; en public.mock_exam_enrolments; en_id uuid;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into g from public.mock_exam_grants where id = p_grant and student_user_id = auth.uid();
  if g.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if g.status <> 'active' or g.expires_at <= now() then raise exception 'QB_MOCK_ENTITLEMENT_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid()) then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  en_id := quizbox_mock.ensure_grant_enrolment(g.id);
  select * into en from public.mock_exam_enrolments where id = en_id;
  return jsonb_build_object('assessment_id', en.assessment_id, 'enrolment_id', en.id, 'version_no', (select version_no from public.mock_exam_versions where id = en.version_id), 'expires_at', g.expires_at);
end $fn$;

revoke all on function quizbox_mock.link_sponsor(uuid), quizbox_mock.ensure_grant_enrolment(uuid), quizbox_mock.link_owner(uuid), quizbox_mock.link_json(public.mock_exam_links) from public, anon, authenticated;
revoke all on function public.qb_mock_family_give(uuid, uuid[]), public.qb_mock_family_revoke(uuid, uuid), public.qb_mock_family_given(uuid), public.qb_mock_link_create(uuid, integer, timestamptz),
  public.qb_mock_link_add_seats(uuid, integer), public.qb_mock_link_close(uuid), public.qb_mock_links(uuid), public.qb_mock_link_info(text), public.qb_mock_link_join(text), public.qb_mock_my_grants(),
  public.qb_mock_start_granted(uuid) from public, anon;
grant execute on function public.qb_mock_family_give(uuid, uuid[]), public.qb_mock_family_revoke(uuid, uuid), public.qb_mock_family_given(uuid), public.qb_mock_link_create(uuid, integer, timestamptz),
  public.qb_mock_link_add_seats(uuid, integer), public.qb_mock_link_close(uuid), public.qb_mock_links(uuid), public.qb_mock_link_info(text), public.qb_mock_link_join(text), public.qb_mock_my_grants(),
  public.qb_mock_start_granted(uuid) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
