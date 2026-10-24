create or replace function public.qb_challenge_event(p_campaign uuid, p_event text) returns void language sql security definer set search_path = '' as $fn$
  insert into public.challenge_events(campaign_id, user_id, event) values (p_campaign, auth.uid(), p_event);
$fn$;
revoke all on function public.qb_challenge_audit(text, uuid, jsonb), public.qb_challenge_event(uuid, text), public.qb_challenge_live(public.challenge_campaigns) from public, anon, authenticated;

-- 4. Anonymous discovery: live public campaigns only. Never returns questions or the access code.
create or replace function public.challenge_public_list(p_limit integer default 24, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.category, c.starts_at, c.ends_at, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants
      from public.challenge_campaigns c
     where c.visibility = 'PUBLIC' and public.qb_challenge_live(c)
     order by coalesce(c.starts_at, c.published_at) desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) t;
$fn$;
create or replace function public.challenge_public_get(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then return null; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then
    return jsonb_build_object('slug', c.slug, 'title', c.title, 'private', true, 'live', public.qb_challenge_live(c));
  end if;
  if c.status not in ('LIVE','PAUSED','COMPLETED') and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title, 'summary', c.summary, 'category', c.category, 'visibility', c.visibility, 'status', c.status,
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;

-- 5. Creator lifecycle.
create or replace function public.challenge_create(p_title text, p_summary text, p_category text, p_visibility text, p_question_count integer, p_time_limit_seconds integer,
  p_max_attempts integer, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_reward_text text default null, p_access_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0; v_id uuid;
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := 'challenge'; end if;
  base := left(base, 50); s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, question_count, time_limit_seconds, max_attempts, starts_at, ends_at, reward_text, access_code)
  values (auth.uid(), s, btrim(p_title), coalesce(p_summary, ''), coalesce(p_category, 'general_knowledge'), coalesce(p_visibility, 'PUBLIC'), coalesce(p_question_count, 10),
          coalesce(p_time_limit_seconds, 600), coalesce(p_max_attempts, 1), p_starts_at, p_ends_at, nullif(btrim(p_reward_text), ''), nullif(btrim(p_access_code), ''))
  returning id into v_id;
  perform public.qb_challenge_audit('challenge_created', v_id);
  return jsonb_build_object('id', v_id, 'slug', s);
end $fn$;

create or replace function public.qb_challenge_owned(p_id uuid) returns public.challenge_campaigns language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (c.owner_id = auth.uid() and public.qb_challenge_creator() or public.qb_challenge_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return c;
end $fn$;
revoke all on function public.qb_challenge_owned(uuid) from public, anon, authenticated;

create or replace function public.challenge_update(p_id uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k text;
begin
  c := public.qb_challenge_owned(p_id);
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title','summary','category','visibility','question_count','time_limit_seconds','max_attempts','starts_at','ends_at','reward_text','access_code') then
      raise exception 'FIELD_NOT_EDITABLE' using errcode = '22023'; end if;
  end loop;
  if c.status <> 'DRAFT' and p_patch ?| array['category','visibility','question_count','time_limit_seconds','max_attempts','access_code'] then
    raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  update public.challenge_campaigns set
    title = coalesce(nullif(btrim(p_patch->>'title'), ''), title), summary = coalesce(p_patch->>'summary', summary),
    category = coalesce(p_patch->>'category', category), visibility = coalesce(p_patch->>'visibility', visibility),
    question_count = coalesce((p_patch->>'question_count')::int, question_count), time_limit_seconds = coalesce((p_patch->>'time_limit_seconds')::int, time_limit_seconds),
    max_attempts = coalesce((p_patch->>'max_attempts')::int, max_attempts),
    starts_at = case when p_patch ? 'starts_at' then (p_patch->>'starts_at')::timestamptz else starts_at end,
    ends_at = case when p_patch ? 'ends_at' then (p_patch->>'ends_at')::timestamptz else ends_at end,
    reward_text = case when p_patch ? 'reward_text' then nullif(btrim(p_patch->>'reward_text'), '') else reward_text end,
    access_code = case when p_patch ? 'access_code' then nullif(btrim(p_patch->>'access_code'), '') else access_code end,
    updated_at = now()
   where id = p_id;
  perform public.qb_challenge_audit('challenge_updated', p_id);
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_set_questions(p_id uuid, p_questions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; q jsonb; i integer := 0; n integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 0 and 200 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  delete from public.challenge_questions where campaign_id = p_id;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    n := jsonb_array_length(q->'options');
    if (q->>'correct_index')::int not between 0 and n - 1 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation)
    values (p_id, i, btrim(q->>'question_text'), q->'options', (q->>'correct_index')::int, nullif(btrim(q->>'explanation'), ''));
  end loop;
  update public.challenge_campaigns set updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_questions_set', p_id, jsonb_build_object('count', i));
  return jsonb_build_object('ok', true, 'count', i);
end $fn$;
