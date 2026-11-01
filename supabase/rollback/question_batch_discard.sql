-- Rollback for 20261051100000_question_batch_discard.sql. Removes the discard function only.
-- Batches that were already discarded stay DISCARDED and their questions stay archived (that is data, not structure). To bring one back, the original file fingerprint is kept
-- in the batch's report ('original_file_sha256') and the questions carry editorial_metadata.discarded_batch.
begin;
drop function if exists public.qb_owner_batch_discard(uuid, text);
commit;
