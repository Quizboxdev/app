-- ───────────── invitations and school entry ─────────────
create or replace function public.interschool_school_search(p_query text default null, p_region text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (select i.id, i.name, i.region, i.district from public.institutions i
     where i.verified_at is not null and lower(coalesce(i.status::text, 'active')) = 'active'
       and (nullif(btrim(p_query), '') is null or i.name ilike '%' || btrim(p_query) || '%') and (nullif(btrim(p_region), '') is null or i.region ilike btrim(p_region))
     order by i.name limit 50) x), '[]'::jsonb);
end $fn$;

create or replace function public.interschool_invite(p_id uuid, p_institutions uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; i uuid; n integer := 0; changed integer;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status not in ('PUBLISHED', 'PAUSED') then raise exception 'IS_PUBLISH_FIRST' using errcode = '55000'; end if;
  if p_institutions is null or cardinality(p_institutions) not between 1 and 200 then raise exception 'IS_SCHOOLS_INVALID' using errcode = '22023'; end if;
  foreach i in array p_institutions loop
    if not exists (select 1 from public.institutions x where x.id = i and x.verified_at is not null) then raise exception 'IS_SCHOOL_NOT_VERIFIED' using errcode = '55000'; end if;
    insert into quizbox_interschool.school_entries(competition_id, institution_id, status, source, invited_by, invited_at) values (c.id, i, 'INVITED', 'INVITE', auth.uid(), now())
    on conflict (competition_id, institution_id) do update set invited_by = excluded.invited_by, invited_at = excluded.invited_at,
      status = case when quizbox_interschool.school_entries.status in ('DECLINED', 'WITHDRAWN') then 'INVITED' else quizbox_interschool.school_entries.status end
      where quizbox_interschool.school_entries.invited_at is null or quizbox_interschool.school_entries.status in ('DECLINED', 'WITHDRAWN');
    get diagnostics changed = row_count;
    if changed > 0 then n := n + 1; perform quizbox_interschool.notify_school(i, 'Competition invitation', 'Your school is invited to ' || c.title || '.', '/interschool/school/' || c.id); end if;
  end loop;
  perform quizbox_interschool.audit('schools_invited', c.id, jsonb_build_object('count', n));
  return jsonb_build_object('ok', true, 'invited', n);
end $fn$;

-- A school accepts or declines (also how an open competition is joined, and how a school withdraws before its roster locks).
create or replace function public.interschool_school_respond(p_id uuid, p_institution uuid, p_accept boolean, p_source text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; e quizbox_interschool.school_entries; was text;
begin
  c := quizbox_interschool.open_competition(p_id);
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into e from quizbox_interschool.school_entries where competition_id = c.id and institution_id = p_institution;
  was := e.status;
  if p_accept then
    perform quizbox_interschool.require_registration_open(c);
    e := quizbox_interschool.enter_school(c, p_institution, p_source);
  else
    if e.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
    if e.status = 'REGISTERED' and quizbox_interschool.roster_locked(c.id, p_institution) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
    update quizbox_interschool.school_entries set status = case when was = 'INVITED' then 'DECLINED' else 'WITHDRAWN' end where id = e.id returning * into e;
    update quizbox_interschool.candidates set status = 'WITHDRAWN', status_reason = 'school withdrew', updated_at = now() where competition_id = c.id and institution_id = p_institution and status in ('PENDING', 'CONFIRMED', 'WAITLISTED');
    -- a waiting school takes the free place, oldest first
    update quizbox_interschool.school_entries set status = 'REGISTERED' where id = (select w.id from quizbox_interschool.school_entries w where w.competition_id = c.id and w.status = 'WAITLISTED' order by w.registered_at, w.id limit 1)
      and (c.max_schools is null or (select count(*) from quizbox_interschool.school_entries x where x.competition_id = c.id and x.status = 'REGISTERED') < c.max_schools);
    perform quizbox_interschool.promote_waiting(c);
  end if;
  perform quizbox_interschool.audit('school_' || lower(e.status), c.id, jsonb_build_object('institution', p_institution));
  return jsonb_build_object('ok', true, 'status', e.status);
end $fn$;

-- ───────────── candidates ─────────────
create or replace function public.interschool_register(p_slug text, p_division uuid, p_institution uuid default null, p_source text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; r jsonb;
begin
  perform quizbox_interschool.require_on();
  c := quizbox_interschool.open_competition((select id from quizbox_interschool.competitions where slug = lower(btrim(p_slug))));
  if c.registration_mode = 'TEACHER' then raise exception 'IS_TEACHER_REGISTRATION_ONLY' using errcode = '55000'; end if;
  perform quizbox_interschool.require_registration_open(c);
  r := quizbox_interschool.add_candidate(c, p_division, p_institution, auth.uid(), p_source, false);
  return r;
end $fn$;

create or replace function public.interschool_nominate(p_id uuid, p_institution uuid, p_division uuid, p_users uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; u uuid; r jsonb; out jsonb := '[]'::jsonb; msg text;
begin
  c := quizbox_interschool.open_competition(p_id);
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if c.registration_mode = 'LEARNER' then raise exception 'IS_LEARNER_REGISTRATION_ONLY' using errcode = '55000'; end if;
  perform quizbox_interschool.require_registration_open(c);
  if quizbox_interschool.roster_locked(c.id, p_institution) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
  if p_users is null or cardinality(p_users) not between 1 and 200 then raise exception 'IS_LEARNERS_INVALID' using errcode = '22023'; end if;
  foreach u in array p_users loop
    begin
      r := quizbox_interschool.add_candidate(c, p_division, p_institution, u, 'SCHOOL', true);
      out := out || jsonb_build_array(r || jsonb_build_object('user_id', u, 'ok', true));
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg !~ '^IS_' then raise; end if;
      out := out || jsonb_build_array(jsonb_build_object('user_id', u, 'ok', false, 'error', msg));
    end;
  end loop;
  perform quizbox_interschool.audit('nominated', c.id, jsonb_build_object('institution', p_institution, 'results', out));
  return jsonb_build_object('results', out);
end $fn$;
