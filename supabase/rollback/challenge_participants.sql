-- Rollback for 20261062100000_challenge_participants.sql: removes the creator's participants list. Nothing else depends on it except the Results tab, which hides the list if the function is missing.
begin;
drop function if exists public.challenge_participants(uuid);
commit;
