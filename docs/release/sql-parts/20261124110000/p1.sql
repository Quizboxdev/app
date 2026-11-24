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
-- Follow-up to 20261124100000. SHS loads still stopped with: invalid input value for enum public.qb_grade: "SHS 3" (and "SHS 1").
-- More than one database function copies a node's printed grade ("SHS 1") into the legacy national grade enum with an unguarded cast: the question import, the question editorial guard (trigger on questions)
-- and the sponsor question delivery. Some databases have the editorial guard from before migration 20261003150000, so patching one function was not enough.
-- This finds every function in the QuizBox schemas that still has the unguarded cast and gives it the same rule: fill the legacy column only when the value is one of the enum's labels, else leave it empty.
-- The market grade columns (source_grade_code, canonical_grade_code) are untouched. Functions that already have the rule are not changed. Safe to run again. It reports each function it patched.
-- Rollback: supabase/rollback/grade_label_every_function.sql
begin;
do $$
declare
  f record; body text; patched text;
  old_expr text := 'coalesce(n.source_grade_code,n.grade_code)::public.qb_grade';
  new_expr text := 'case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end';
  keep text := '@@GUARDED_GRADE@@';
  n integer := 0;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where p.prokind = 'f' and s.nspname in ('public','quizbox_private','quizbox_factory','quizbox_competition','quizbox_market') loop
    body := pg_get_functiondef(f.oid);
    if position(old_expr in body) = 0 then continue; end if;
    patched := replace(replace(replace(body, new_expr, keep), old_expr, new_expr), keep, new_expr);
    if patched = body then continue; end if;
    execute patched;
    n := n + 1;
    raise notice 'patched %', f.sig;
  end loop;
  raise notice 'functions patched: %', n;
end $$;
commit;
