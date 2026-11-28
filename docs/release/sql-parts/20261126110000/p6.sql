-- One school's roster for one competition (that school's staff, or a platform administrator).
create or replace function public.interschool_school_roster(p_id uuid, p_institution uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; e quizbox_interschool.school_entries;
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.staff_of(p_institution) or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into c from quizbox_interschool.competitions where id = p_id and status not in ('DRAFT', 'PENDING_APPROVAL');
  select * into e from quizbox_interschool.school_entries where competition_id = c.id and institution_id = p_institution;
  if c.id is null or (e.id is null and c.participation <> 'OPEN') then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('competition', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'rules', c.rules, 'registration', quizbox_interschool.registration_state(c),
      'registration_closes_at', c.registration_closes_at, 'registration_mode', c.registration_mode, 'max_per_school', c.max_per_school, 'max_per_level_per_school', c.max_per_level_per_school),
    'school', (select i.name from public.institutions i where i.id = p_institution), 'entry_status', e.status, 'locked', quizbox_interschool.roster_locked(c.id, p_institution),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'level_codes', d.level_codes,
        'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'user_id', k.user_id, 'name', p.full_name, 'status', k.status, 'verified', quizbox_interschool.learner_verified(k.user_id, p_institution)) order by k.status, p.full_name)
           from quizbox_interschool.candidates k join public.profiles p on p.id = k.user_id where k.division_id = d.id and k.institution_id = p_institution and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED')), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb));
end $fn$;

-- Learners of a school at a division's class level who are not yet registered, for nomination.
create or replace function public.interschool_school_learners(p_id uuid, p_institution uuid, p_division uuid, p_query text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into d from quizbox_interschool.divisions where id = p_division and competition_id = p_id;
  if d.id is null then raise exception 'IS_DIVISION_NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select p.id as user_id, p.full_name as name, quizbox_interschool.level_of(p.id) as level
      from public.profiles p join public.student_profiles s on s.user_id = p.id
     where lower(p.status::text) = 'active' and quizbox_interschool.level_of(p.id) = any(d.level_codes) and quizbox_interschool.school_learner(p.id, p_institution)
       and (s.managed_by is null or coalesce(quizbox_core.flag('interschool.allow_managed_learners'), false))
       and (nullif(btrim(p_query), '') is null or p.full_name ilike '%' || btrim(p_query) || '%')
       and not exists (select 1 from quizbox_interschool.candidates k where k.competition_id = p_id and k.user_id = p.id and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED'))
     order by p.full_name limit 200) x), '[]'::jsonb);
end $fn$;

-- The organiser's registration monitor: numbers per school and level. Learner names are not included (each school sees its own).
create or replace function public.interschool_registrations(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return jsonb_build_object('registration', quizbox_interschool.registration_state(c), 'capacity', c.capacity, 'expected', c.expected_participants,
    'held', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED')),
    'waiting', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status = 'WAITLISTED'),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('institution_id', e.institution_id, 'school', i.name, 'region', i.region, 'status', e.status, 'source', e.source, 'locked', e.roster_locked_at is not null,
        'confirmed', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'CONFIRMED'),
        'pending', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'PENDING'),
        'waiting', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'WAITLISTED')) order by i.name)
      from quizbox_interschool.school_entries e join public.institutions i on i.id = e.institution_id where e.competition_id = c.id), '[]'::jsonb),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'capacity', d.capacity,
        'confirmed', (select count(*) from quizbox_interschool.candidates k where k.division_id = d.id and k.status = 'CONFIRMED'),
        'pending', (select count(*) from quizbox_interschool.candidates k where k.division_id = d.id and k.status = 'PENDING')) order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(s.source, s.n) from (select k.source, count(*) n from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED') group by k.source) s), '{}'::jsonb),
    'views', coalesce((select jsonb_object_agg(coalesce(v.source, 'DIRECT'), v.n) from (select source, count(*) n from quizbox_interschool.events where competition_id = c.id and kind = 'view' group by source) v), '{}'::jsonb));
end $fn$;
