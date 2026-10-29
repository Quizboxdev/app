-- QuizBox Competitions, sharing and the free-allowance rule for joining.
-- A Challenge is one timed round (speed and understanding). A Competition has rounds; each round can pass people on by a pass mark and/or "top N go through".
-- Both use the same engine (challenge_campaigns) and are told apart by campaigns.format. Anyone signed in (learners included, never managed under-13 learners)
-- may create one and share the link; a teacher or school administrator may also aim one at a class or a whole school. Joining needs an account, and a learner's
-- first join of a challenge or competition uses one session of the free allowance (the same allowance as practice), after which the app sends them to Subscribe.
-- Builds on 20261021100000, 20261022100000, 20261023100000 and 20261018100000. Additive and idempotent. Rollback: supabase/rollback/competitions_and_sharing.sql.


-- 1. Columns.
alter table public.challenge_campaigns
  add column if not exists format text not null default 'CHALLENGE' check (format in ('CHALLENGE','COMPETITION')),
  add column if not exists audience_class_id uuid references public.classes(id) on delete set null,
  add column if not exists audience_institution_id uuid references public.institutions(id) on delete set null;
alter table public.challenge_stages
  add column if not exists advance_top_n integer check (advance_top_n is null or advance_top_n between 1 and 100000);
create index if not exists challenge_campaigns_format on public.challenge_campaigns(format, status, visibility);

-- 2. Who may create: anyone signed in with an active, non-managed account (learners create and share; the daily limit is lower for them).
create or replace function public.qb_challenge_creator() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user();
$fn$;

-- 3. Audience: a campaign aimed at a class or a school is open only to its members, its teacher or administrators, and its owner.
create or replace function public.qb_challenge_in_audience(c public.challenge_campaigns) returns boolean language sql stable security definer set search_path = '' as $fn$
  select (c.audience_class_id is null and c.audience_institution_id is null)
    or c.owner_id = auth.uid()
    or exists (select 1 from public.class_memberships m where m.class_id = c.audience_class_id and m.student_user_id = auth.uid() and lower(m.status::text) = 'active')
    or exists (select 1 from public.classes k where k.id = c.audience_class_id and k.teacher_user_id = auth.uid())
    or exists (select 1 from public.institution_memberships im where im.institution_id = c.audience_institution_id and im.user_id = auth.uid() and im.status::text = 'active')
    or exists (select 1 from public.class_memberships m join public.classes k on k.id = m.class_id
                where k.institution_id = c.audience_institution_id and m.student_user_id = auth.uid() and lower(m.status::text) = 'active')
$fn$;

create or replace function public.qb_challenge_school_admin(p_institution uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_institution is not null and exists (select 1 from public.institution_memberships im where im.institution_id = p_institution and im.user_id = auth.uid()
                                               and im.role::text in ('admin','owner') and im.status::text = 'active');
$fn$;

-- The classes and schools this person may aim a campaign at.
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

-- 4. Creating: a format, and a lower daily limit for learners.
drop function if exists public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text);
create or replace function public.challenge_create(p_title text, p_summary text, p_category text, p_visibility text, p_question_count integer, p_time_limit_seconds integer,
  p_max_attempts integer, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_reward_text text default null, p_access_code text default null,
  p_format text default 'CHALLENGE') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0; v_id uuid; v_format text := upper(coalesce(nullif(btrim(p_format), ''), 'CHALLENGE')); v_limit integer;
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_format not in ('CHALLENGE','COMPETITION') then raise exception 'INVALID_FORMAT' using errcode = '22023'; end if;
  v_limit := case when exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) = 'student') then 5 else 20 end;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= v_limit then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := lower(v_format); end if;
  base := left(base, 50); s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, question_count, time_limit_seconds, max_attempts, starts_at, ends_at, reward_text, access_code, format)
  values (auth.uid(), s, btrim(p_title), coalesce(p_summary, ''), coalesce(p_category, 'general_knowledge'), coalesce(p_visibility, 'PUBLIC'), coalesce(p_question_count, 10),
          coalesce(p_time_limit_seconds, 600), coalesce(p_max_attempts, 1), p_starts_at, p_ends_at, nullif(btrim(p_reward_text), ''), nullif(btrim(p_access_code), ''), v_format)
  returning id into v_id;
  perform public.qb_challenge_audit('challenge_created', v_id, jsonb_build_object('format', v_format));
  return jsonb_build_object('id', v_id, 'slug', s, 'format', v_format);
end $fn$;
