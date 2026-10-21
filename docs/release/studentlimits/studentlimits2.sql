grant execute on function public.challenge_set_questions(uuid, jsonb), public.challenge_creator_get(uuid) to authenticated;

notify pgrst, 'reload schema';

