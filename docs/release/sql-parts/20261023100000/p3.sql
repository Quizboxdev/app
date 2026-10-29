grant execute on function public.challenge_publish(uuid), public.challenge_finalize(uuid), public.challenge_award_update(uuid, text, text) to authenticated;
revoke all on function public.challenge_public_get(text), public.challenge_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
