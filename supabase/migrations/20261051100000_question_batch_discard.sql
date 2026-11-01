-- Question batches: a way out for a batch that cannot be finished. A load that stops partway, fails, or is loaded but not wanted left a batch with no action available: its
-- questions sat in review for ever and its file fingerprint blocked loading the same file again. A super admin can now DISCARD such a batch:
--   * its questions are withdrawn (archived and marked rejected, never deleted, so the audit trail and the question history stay intact),
--   * the batch is marked DISCARDED, with who did it, when and why recorded in its report,
--   * its file fingerprint is released (the original is kept in the report), so the same file can be loaded again from scratch.
-- A batch that is live for learners cannot be discarded: revoke its approval first. Additive and idempotent. Rollback: supabase/rollback/question_batch_discard.sql.
begin;

create or replace function public.qb_owner_batch_discard(p_batch uuid, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; withdrawn integer; v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status = 'DISCARDED' then raise exception 'QB_BATCH_ALREADY_DISCARDED'; end if;
  if exists (select 1 from public.question_batch_approvals a where a.batch_id = b.id and a.status = 'ACTIVE') then raise exception 'QB_BATCH_IS_LIVE'; end if;
  if length(v_note) < 10 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  tag := 'source:QL:' || b.id || ':%';
  update public.questions q
     set status = 'archived', validation_status = 'rejected',
         editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('discarded_batch', b.id, 'discard_note', v_note)
   where exists (select 1 from unnest(q.tags) t where t like tag);
  get diagnostics withdrawn = row_count;
  update public.question_load_batches
     set status = 'DISCARDED', completed_at = coalesce(completed_at, now()),
         file_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(b.file_sha256 || ':' || b.id::text, 'UTF8')), 'hex'),
         report = coalesce(report, '{}'::jsonb) || jsonb_build_object('discarded_by', auth.uid(), 'discarded_at', now(), 'discard_note', v_note, 'original_file_sha256', b.file_sha256, 'questions_withdrawn', withdrawn)
   where id = b.id;
  return jsonb_build_object('batch_id', b.id, 'withdrawn', withdrawn);
end $fn$;

revoke all on function public.qb_owner_batch_discard(uuid, text) from public, anon;
grant execute on function public.qb_owner_batch_discard(uuid, text) to authenticated;

commit;
