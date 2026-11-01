-- Rollback for 20261052100000_owner_batch_steps.sql. Removes the three step functions. The original single-call approve and revoke functions were never touched.
-- Left in place on purpose (data, not structure): the in_progress column, the wider batch status list (DISCARDING, DISCARDED) and any batch already discarded.
-- The older qb_owner_batch_discard(uuid, text) that this migration dropped is not restored: it could not work on the real tables. Re-run 20261051100000 if it is ever wanted.
begin;
drop function if exists public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer);
drop function if exists public.qb_owner_revoke_batch_approval_step(uuid, text, integer);
drop function if exists public.qb_owner_batch_discard_step(uuid, text, integer);
commit;
