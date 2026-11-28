-- Applies the editable settings in p to a competition row (unknown keys are refused, so a typing mistake cannot be silently ignored).
create or replace function quizbox_interschool.apply_settings(c quizbox_interschool.competitions, p jsonb) returns quizbox_interschool.competitions language plpgsql stable security definer set search_path = '' as $fn$
declare bad text;
begin
  select k into bad from jsonb_object_keys(p) k where k not in ('title', 'description', 'sponsor_name', 'sponsor_logo_url', 'flyer_url', 'scale', 'region', 'district', 'participation', 'entry_mode',
    'registration_mode', 'funding', 'max_schools', 'max_per_school', 'max_per_level_per_school', 'expected_participants', 'capacity', 'waitlist', 'registration_opens_at', 'registration_closes_at',
    'opens_at', 'ends_at', 'rules', 'prizes', 'school_scoring', 'scoring_top_n', 'min_candidates', 'score_carry') limit 1;
  if bad is not null then raise exception 'IS_UNKNOWN_SETTING' using errcode = '22023', detail = bad; end if;
  c := jsonb_populate_record(c, p);
  c.title := btrim(c.title);
  return c;
end $fn$;

create or replace function public.interschool_create(p_settings jsonb, p_host uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; kind text;
begin
  perform quizbox_interschool.require_on();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or length(btrim(coalesce(p_settings ->> 'title', ''))) < 3 then raise exception 'IS_TITLE_REQUIRED' using errcode = '22023'; end if;
  if quizbox_interschool.is_admin() then kind := 'ADMIN';
  elsif p_host is not null and quizbox_interschool.staff_of(p_host) then kind := 'SCHOOL';
  elsif quizbox_interschool.approved_sponsor() then kind := 'SPONSOR';
  else raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  if (select count(*) from quizbox_interschool.competitions x where x.organiser_user_id = auth.uid() and x.created_at > now() - interval '1 day') >= 40 then raise exception 'IS_RATE_LIMITED' using errcode = '53400'; end if;
  c.id := gen_random_uuid(); c.slug := quizbox_interschool.slugify(p_settings ->> 'title'); c.title := p_settings ->> 'title'; c.description := ''; c.organiser_user_id := auth.uid(); c.organiser_kind := kind;
  c.host_institution_id := case when kind = 'SCHOOL' or (kind = 'ADMIN' and p_host is not null) then p_host end;
  c.scale := 'SCHOOLS'; c.participation := 'INVITE'; c.entry_mode := 'SCHOOL_TEAM'; c.registration_mode := 'BOTH'; c.funding := case when kind = 'SPONSOR' then 'SPONSORED' else 'FREE' end;
  c.expected_participants := 100; c.capacity := 100; c.waitlist := false; c.rules := ''; c.prizes := ''; c.school_scoring := 'TOP_N'; c.scoring_top_n := 5; c.min_candidates := 1; c.score_carry := 'RESET';
  c.status := 'DRAFT'; c.funded_participants := 0; c.created_at := now(); c.updated_at := now();
  c := quizbox_interschool.apply_settings(c, p_settings);
  if kind = 'SPONSOR' and c.funding <> 'SPONSORED' then raise exception 'IS_SPONSOR_MUST_FUND' using errcode = '22023'; end if;
  if kind = 'SCHOOL' and c.funding = 'COMPLIMENTARY' then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  insert into quizbox_interschool.competitions select (c).*;
  perform quizbox_interschool.audit('created', c.id, jsonb_build_object('kind', kind));
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'organiser_kind', kind, 'status', 'DRAFT');
end $fn$;

-- Drafts can change everything. After publishing, only presentation can change, capacity can grow (within funding) and closing dates can move later: rules and scoring are frozen.
create or replace function public.interschool_update(p_id uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; n quizbox_interschool.competitions; bad text;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status in ('COMPLETED', 'CANCELLED') then raise exception 'IS_COMPETITION_CLOSED' using errcode = '55000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'IS_UNKNOWN_SETTING' using errcode = '22023'; end if;
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then
    select k into bad from jsonb_object_keys(p_patch) k where k not in ('title', 'description', 'sponsor_name', 'sponsor_logo_url', 'flyer_url', 'prizes', 'capacity', 'max_schools', 'waitlist', 'registration_closes_at', 'ends_at') limit 1;
    if bad is not null then raise exception 'IS_FROZEN_AFTER_PUBLISH' using errcode = '55000', detail = bad; end if;
  end if;
  n := quizbox_interschool.apply_settings(c, p_patch);
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then
    if n.capacity < c.capacity or (c.max_schools is not null and n.max_schools < c.max_schools) then raise exception 'IS_CAPACITY_CANNOT_SHRINK' using errcode = '55000'; end if;
    if n.registration_closes_at < c.registration_closes_at or n.ends_at < c.ends_at then raise exception 'IS_DATE_CANNOT_MOVE_EARLIER' using errcode = '55000'; end if;
    if n.funding = 'SPONSORED' and n.capacity > greatest(c.funded_participants, c.capacity) then raise exception 'IS_FUNDING_REQUIRED_FOR_CAPACITY' using errcode = '55000'; end if;
  end if;
  if c.organiser_kind = 'SPONSOR' and n.funding <> c.funding and not quizbox_interschool.is_admin() then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  if n.funding = 'COMPLIMENTARY' and c.funding <> 'COMPLIMENTARY' and not quizbox_interschool.is_admin() then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  -- A change to a draft that was waiting for, or had, approval must be approved again.
  if c.status in ('DRAFT', 'PENDING_APPROVAL') and (n.participation, n.scale, n.funding, n.capacity, n.expected_participants) is distinct from (c.participation, c.scale, c.funding, c.capacity, c.expected_participants) and not quizbox_interschool.is_admin() then
    n.approved_at := null; n.approved_by := null;
  end if;
  n.updated_at := now();
  update quizbox_interschool.competitions x set
    title = n.title, description = n.description, sponsor_name = n.sponsor_name, sponsor_logo_url = n.sponsor_logo_url, flyer_url = n.flyer_url, scale = n.scale, region = n.region, district = n.district,
    participation = n.participation, entry_mode = n.entry_mode, registration_mode = n.registration_mode, funding = n.funding, max_schools = n.max_schools, max_per_school = n.max_per_school,
    max_per_level_per_school = n.max_per_level_per_school, expected_participants = n.expected_participants, capacity = n.capacity, waitlist = n.waitlist, registration_opens_at = n.registration_opens_at,
    registration_closes_at = n.registration_closes_at, opens_at = n.opens_at, ends_at = n.ends_at, rules = n.rules, prizes = n.prizes, school_scoring = n.school_scoring, scoring_top_n = n.scoring_top_n,
    min_candidates = n.min_candidates, score_carry = n.score_carry, approved_at = n.approved_at, approved_by = n.approved_by, updated_at = n.updated_at
  where x.id = c.id;
  perform quizbox_interschool.audit('updated', c.id, jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
  return jsonb_build_object('ok', true);
end $fn$;
