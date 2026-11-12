-- Rollback for 20261065100000_challenge_live_details.sql: challenge_update goes back to the original from 20261021100000 (no ended-challenge, opening-time or date checks; the audit entry carries no details).
begin;

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

revoke all on function public.challenge_update(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.challenge_update(uuid, jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
