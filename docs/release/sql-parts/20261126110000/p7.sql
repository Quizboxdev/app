-- What a signed-in person can register for: their class level, the divisions that fit, the schools they belong to and any registration they already have.
create or replace function public.interschool_join_options(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; lv text; learner boolean; managed boolean;
begin
  perform quizbox_interschool.require_on();
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and status not in ('DRAFT', 'PENDING_APPROVAL');
  if c.id is null then return null; end if;
  select true, s.managed_by is not null into learner, managed from public.student_profiles s where s.user_id = auth.uid();
  lv := quizbox_interschool.level_of(auth.uid());
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'rules', c.rules, 'registration', quizbox_interschool.registration_state(c), 'registration_mode', c.registration_mode,
    'learner', coalesce(learner, false), 'managed', coalesce(managed, false), 'level', lv, 'individual_allowed', c.entry_mode = 'INDIVIDUAL' and c.participation = 'OPEN',
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title) order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id and lv = any(d.level_codes)), '[]'::jsonb),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'verified_member', quizbox_interschool.learner_verified(auth.uid(), i.id),
        'can_enter', c.participation = 'OPEN' or exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = i.id and e.status in ('INVITED', 'REGISTERED', 'WAITLISTED'))) order by i.name)
      from public.institutions i where i.verified_at is not null and quizbox_interschool.school_learner(auth.uid(), i.id)), '[]'::jsonb),
    'mine', (select jsonb_build_object('status', k.status, 'division', d.title) from quizbox_interschool.candidates k join quizbox_interschool.divisions d on d.id = k.division_id
              where k.competition_id = c.id and k.user_id = auth.uid() and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED') limit 1));
end $fn$;

-- The public page: what anyone may know. Never questions, never learner names.
create or replace function public.interschool_public_get(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  if not (coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false)) then return null; end if;
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and status in ('PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED') and published_at is not null;
  if c.id is null then return null; end if;
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'description', c.description, 'status', c.status, 'participation', c.participation, 'entry_mode', c.entry_mode,
    'registration_mode', c.registration_mode, 'scale', c.scale, 'region', c.region, 'district', c.district, 'sponsor_name', c.sponsor_name, 'sponsor_logo_url', c.sponsor_logo_url, 'flyer_url', c.flyer_url,
    'host', (select i.name from public.institutions i where i.id = c.host_institution_id), 'rules', c.rules, 'prizes', c.prizes, 'funding', c.funding, 'school_scoring', c.school_scoring,
    'registration', quizbox_interschool.registration_state(c), 'registration_opens_at', c.registration_opens_at, 'registration_closes_at', c.registration_closes_at, 'opens_at', c.opens_at, 'ends_at', c.ends_at,
    'schools_registered', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = c.id and e.status = 'REGISTERED'), 'max_schools', c.max_schools,
    'places_left', greatest(c.capacity - (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED')), 0), 'max_per_school', c.max_per_school,
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'level_codes', d.level_codes,
        'subjects', coalesce((select jsonb_agg(distinct n.title) from quizbox_interschool.rounds r cross join lateral jsonb_array_elements(r.sections) s join public.curriculum_nodes n on n.id = (s.value ->> 'subject_id')::uuid where r.division_id = d.id), '[]'::jsonb),
        'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_no', r.round_no, 'title', r.title, 'opens_at', r.opens_at, 'closes_at', r.closes_at, 'question_count', r.question_count,
            'duration_seconds', r.duration_seconds, 'rule', r.rule, 'pass_percent', r.pass_percent, 'top_n', r.top_n) order by r.round_no) from quizbox_interschool.rounds r where r.division_id = d.id), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb),
    'listed', c.listed_at is not null);
end $fn$;

-- Discovery: only competitions an administrator has listed (the home page, Open to join and the promotional feed use this).
create or replace function public.interschool_public_list(p_limit integer default 12) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false) then
    coalesce((select jsonb_agg(row_to_json(t)) from (
      select c.slug, c.title, left(c.description, 200) as summary, c.sponsor_name, c.sponsor_logo_url, c.registration_closes_at, c.opens_at, c.ends_at, quizbox_interschool.registration_state(c) as registration,
             (select jsonb_agg(d.title order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id) as divisions
        from quizbox_interschool.competitions c
       where c.listed_at is not null and c.participation = 'OPEN' and c.status in ('PUBLISHED', 'PAUSED') and (c.ends_at is null or c.ends_at > now())
       order by c.listed_at desc limit least(greatest(coalesce(p_limit, 12), 1), 48)) t), '[]'::jsonb)
  else '[]'::jsonb end
$fn$;

-- Listing on public discovery is approved by an administrator.
create or replace function public.interschool_set_listed(p_id uuid, p_listed boolean) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id, true);
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_listed and (c.participation <> 'OPEN' or c.status not in ('PUBLISHED', 'PAUSED')) then raise exception 'IS_ONLY_OPEN_PUBLISHED_CAN_BE_LISTED' using errcode = '55000'; end if;
  update quizbox_interschool.competitions set listed_at = case when p_listed then now() end, listed_by = case when p_listed then auth.uid() end, updated_at = now() where id = c.id;
  perform quizbox_interschool.audit(case when p_listed then 'listed' else 'unlisted' end, c.id);
  return jsonb_build_object('ok', true, 'listed', p_listed);
end $fn$;

-- Visits and shares are counted by the server (a visitor may not be signed in).
create or replace function public.interschool_track(p_slug text, p_kind text, p_source text default null) returns void language sql security definer set search_path = '' as $fn$
  insert into quizbox_interschool.events(competition_id, kind, source)
  select c.id, p_kind, quizbox_interschool.source_of(p_source) from quizbox_interschool.competitions c
   where c.slug = lower(btrim(p_slug)) and c.published_at is not null and p_kind in ('view', 'share')
$fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
