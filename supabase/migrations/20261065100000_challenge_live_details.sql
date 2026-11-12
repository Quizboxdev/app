begin;
-- A creator can fix the title or description of a challenge that is already live, and move its closing time (usually later). Questions, scoring, rounds and audience stay locked.
-- challenge_update already allowed title, summary, starts_at and ends_at at any status, but nothing in the app offered it and it had no date checks, so a live challenge could be given an end
-- time in the past, a closing time before its opening time, or a new opening time after people had already started. This version adds those checks and records what changed.
--   CHALLENGE_ENDED   the challenge is COMPLETED or ARCHIVED: nothing can be changed (use a new challenge instead).
--   ALREADY_OPENED    the opening time cannot change once the challenge has opened.
--   INVALID_DATES     the closing time must be after the opening time.
--   ENDS_IN_THE_PAST  a live or paused challenge cannot be given a closing time that has already passed (use End instead).
-- Only public.challenge_update changes; the signature is the same. Rollback: supabase/rollback/challenge_live_details.sql

create or replace function public.challenge_update(p_id uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k text; v_start timestamptz; v_end timestamptz;
begin
  c := public.qb_challenge_owned(p_id);
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title','summary','category','visibility','question_count','time_limit_seconds','max_attempts','starts_at','ends_at','reward_text','access_code') then
      raise exception 'FIELD_NOT_EDITABLE' using errcode = '22023'; end if;
  end loop;
  if c.status in ('COMPLETED','ARCHIVED') then raise exception 'CHALLENGE_ENDED' using errcode = '55000'; end if;
  if c.status <> 'DRAFT' and p_patch ?| array['category','visibility','question_count','time_limit_seconds','max_attempts','access_code'] then
    raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  v_start := case when p_patch ? 'starts_at' then nullif(p_patch->>'starts_at', '')::timestamptz else c.starts_at end;
  v_end := case when p_patch ? 'ends_at' then nullif(p_patch->>'ends_at', '')::timestamptz else c.ends_at end;
  if c.status <> 'DRAFT' and p_patch ? 'starts_at' and v_start is distinct from c.starts_at and (c.starts_at is null or c.starts_at <= now()) then
    raise exception 'ALREADY_OPENED' using errcode = '55000'; end if;
  if v_start is not null and v_end is not null and v_end <= v_start then raise exception 'INVALID_DATES' using errcode = '22023'; end if;
  if c.status in ('LIVE','PAUSED') and p_patch ? 'ends_at' and v_end is not null and v_end <= now() then raise exception 'ENDS_IN_THE_PAST' using errcode = '22023'; end if;
  update public.challenge_campaigns set
    title = coalesce(nullif(btrim(p_patch->>'title'), ''), title), summary = coalesce(p_patch->>'summary', summary),
    category = coalesce(p_patch->>'category', category), visibility = coalesce(p_patch->>'visibility', visibility),
    question_count = coalesce((p_patch->>'question_count')::int, question_count), time_limit_seconds = coalesce((p_patch->>'time_limit_seconds')::int, time_limit_seconds),
    max_attempts = coalesce((p_patch->>'max_attempts')::int, max_attempts),
    starts_at = case when p_patch ? 'starts_at' then v_start else starts_at end,
    ends_at = case when p_patch ? 'ends_at' then v_end else ends_at end,
    reward_text = case when p_patch ? 'reward_text' then nullif(btrim(p_patch->>'reward_text'), '') else reward_text end,
    access_code = case when p_patch ? 'access_code' then nullif(btrim(p_patch->>'access_code'), '') else access_code end,
    updated_at = now()
   where id = p_id;
  perform public.qb_challenge_audit('challenge_updated', p_id, jsonb_build_object('status', c.status, 'fields', (select jsonb_agg(f) from jsonb_object_keys(p_patch) f),
    'title_from', c.title, 'ends_at_from', c.ends_at, 'ends_at_to', v_end));
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.challenge_update(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.challenge_update(uuid, jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
