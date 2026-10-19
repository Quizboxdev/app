grant execute on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text), public.challenge_update(uuid, jsonb),
  public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer), public.challenge_publish(uuid), public.challenge_set_status(uuid, text),
  public.challenge_my_campaigns(), public.challenge_creator_get(uuid), public.challenge_start(text, text), public.challenge_submit(uuid, jsonb), public.challenge_my_attempts(),
  public.qb_challenge_creator() to authenticated;

