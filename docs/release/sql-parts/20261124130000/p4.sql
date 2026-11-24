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
