-- Rollback for 20261085100000_family_challenges.sql: removes the functions. The invitations table stays, so nothing a family sent is lost.
begin;
drop function if exists public.qb_family_my_challenges();
drop function if exists public.qb_family_uninvite_challenge(uuid, uuid);
drop function if exists public.qb_family_invite_challenge(uuid, uuid[]);
drop function if exists public.qb_family_challenges();
commit;
