create or replace function public.interschool_request_approval(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status <> 'DRAFT' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  update quizbox_interschool.competitions set status = 'PENDING_APPROVAL', decision_note = null, updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('submitted', c.id);
  return jsonb_build_object('ok', true, 'status', 'PENDING_APPROVAL');
end $fn$;

create or replace function public.interschool_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into c from quizbox_interschool.competitions where id = p_id for update;
  if c.id is null or c.status <> 'PENDING_APPROVAL' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.competitions set status = 'DRAFT', approved_at = case when p_approve then now() end, approved_by = case when p_approve then auth.uid() end,
         decision_note = nullif(btrim(p_note), ''), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit(case when p_approve then 'approved' else 'declined' end, c.id, jsonb_build_object('note', p_note));
  perform quizbox_interschool.notify(c.organiser_user_id, case when p_approve then 'Competition approved' else 'Competition needs changes' end,
    c.title || case when p_approve then ' is approved. You can publish it.' else ': ' || coalesce(p_note, '') end, '/interschool/manage/' || c.id);
  return jsonb_build_object('ok', true, 'approved', p_approve);
end $fn$;

create or replace function public.interschool_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; probs jsonb; d record; r record; papers integer := 0;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status <> 'DRAFT' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if quizbox_interschool.needs_approval(c) and c.approved_at is null then raise exception 'IS_APPROVAL_REQUIRED' using errcode = '55000'; end if;
  probs := quizbox_interschool.problems(c);
  if jsonb_array_length(probs) > 0 then raise exception 'IS_NOT_READY' using errcode = '55000', detail = probs::text; end if;
  -- Funded competitions may be announced only after verified payment or an authorised funding approval.
  if c.funding = 'SPONSORED' and (c.funding_cleared_at is null or c.funded_participants < c.capacity) then raise exception 'IS_FUNDING_REQUIRED' using errcode = '55000'; end if;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id order by v.position loop
    for r in select * from quizbox_interschool.rounds x where x.division_id = d.id order by x.round_no loop
      delete from quizbox_interschool.papers where round_id = r.id and fixture_id is null;
      perform quizbox_interschool.freeze_paper(r.id, null, d.level_codes, r.sections); papers := papers + 1;
    end loop;
  end loop;
  update quizbox_interschool.competitions set status = 'PUBLISHED', published_at = coalesce(published_at, now()), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('published', c.id, jsonb_build_object('papers_frozen', papers));
  return jsonb_build_object('ok', true, 'slug', c.slug, 'papers_frozen', papers);
end $fn$;

create or replace function public.interschool_set_status(p_id uuid, p_status text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; v text := upper(coalesce(p_status, '')); ok boolean;
begin
  c := quizbox_interschool.managed(p_id, true);
  ok := (c.status = 'PUBLISHED' and v in ('PAUSED', 'CLOSED', 'CANCELLED')) or (c.status = 'PAUSED' and v in ('PUBLISHED', 'CLOSED', 'CANCELLED'))
     or (c.status = 'CLOSED' and v in ('PUBLISHED', 'CANCELLED')) or (c.status in ('DRAFT', 'PENDING_APPROVAL') and v = 'CANCELLED');
  if not ok then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if v = 'CANCELLED' and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.competitions set status = v, decision_note = coalesce(nullif(btrim(p_reason), ''), decision_note), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('status_' || lower(v), c.id, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'status', v);
end $fn$;

create or replace function public.interschool_duplicate(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; n quizbox_interschool.competitions; d record; nd uuid;
begin
  c := quizbox_interschool.managed(p_id);
  n := c; n.id := gen_random_uuid(); n.title := left(c.title || ' (copy)', 140); n.slug := quizbox_interschool.slugify(n.title); n.organiser_user_id := auth.uid();
  n.status := 'DRAFT'; n.approved_at := null; n.approved_by := null; n.decision_note := null; n.funding_cleared_at := null; n.funded_participants := 0; n.listed_at := null; n.listed_by := null;
  n.published_at := null; n.finalised_at := null; n.registration_opens_at := null; n.registration_closes_at := null; n.opens_at := null; n.ends_at := null; n.created_at := now(); n.updated_at := now();
  if quizbox_interschool.is_admin() and c.organiser_user_id <> auth.uid() then n.organiser_kind := 'ADMIN'; end if;
  insert into quizbox_interschool.competitions select (n).*;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id loop
    insert into quizbox_interschool.divisions(competition_id, position, title, level_codes, mixed, capacity) values (n.id, d.position, d.title, d.level_codes, d.mixed, d.capacity) returning id into nd;
    insert into quizbox_interschool.rounds(division_id, round_no, title, format, stage, opens_at, closes_at, duration_seconds, sections, question_count, rule, pass_percent, top_n)
    select nd, r.round_no, r.title, r.format, r.stage, r.opens_at, r.closes_at, r.duration_seconds, r.sections, r.question_count, r.rule, r.pass_percent, r.top_n from quizbox_interschool.rounds r where r.division_id = d.id;
  end loop;
  perform quizbox_interschool.audit('duplicated', n.id, jsonb_build_object('from', c.id));
  return jsonb_build_object('id', n.id, 'slug', n.slug);
end $fn$;

-- The organiser's own view: full configuration (never any question or answer key).
create or replace function public.interschool_manage_get(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return to_jsonb(c) || jsonb_build_object('is_admin', quizbox_interschool.is_admin(), 'needs_approval', quizbox_interschool.needs_approval(c),
    'divisions', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('rounds',
        coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('frozen', exists (select 1 from quizbox_interschool.papers p where p.round_id = r.id)) order by r.round_no) from quizbox_interschool.rounds r where r.division_id = d.id), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb));
end $fn$;
