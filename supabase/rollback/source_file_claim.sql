-- Rolls back 20261012150000_source_file_claim.sql. Files already supplied stay recorded as ordinary fetched sources.
begin;
drop function if exists public.qb_source_claim_file(uuid);
commit;
