create or replace function public.qb_owner_revoke_batch_approval_step(p_approval uuid, p_note text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.question_batch_approvals; ids uuid[]; n integer; returned integer; lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.question_batch_approvals where id = p_approval for update;
  if a.id is null then raise exception 'QB_APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'ACTIVE' then raise exception 'QB_APPROVAL_NOT_ACTIVE'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  select array_agg(s.id) into ids from (
    select q.id from public.questions q where public.qb_ql_batches(q.tags) @> array[a.batch_id] and q.editorial_metadata ->> 'approval_id' = a.id::text and q.validation_status = 'approved' order by q.id limit lim) s;
  n := coalesce(cardinality(ids), 0);
  if n > 0 then
    update public.questions q set validation_status = 'review', status = 'inactive', reviewed_by = null, reviewed_at = null,
           editorial_metadata = (coalesce(q.editorial_metadata, '{}'::jsonb) - 'human_reviewed' - 'approval_basis' - 'approval_id' - 'review_note') || jsonb_build_object('owner_approval_revoked', a.id)
     where q.id = any(ids);
  end if;
  select count(*)::integer into returned from public.questions q where public.qb_ql_batches(q.tags) @> array[a.batch_id] and q.editorial_metadata ->> 'owner_approval_revoked' = a.id::text;
  if n < lim then
    update public.question_batch_approvals set status = 'REVOKED', in_progress = false, revoked_at = now(), revoked_by = auth.uid(), revoke_note = btrim(p_note) where id = a.id;
    return jsonb_build_object('approval_id', a.id, 'done', true, 'returned_to_review', returned);
  end if;
  return jsonb_build_object('approval_id', a.id, 'done', false, 'returned_to_review', returned);
end $fn$;

create or replace function public.qb_owner_batch_discard_step(p_batch uuid, p_note text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; ids uuid[]; n integer; withdrawn integer; v_note text := left(btrim(coalesce(p_note, '')), 500); lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status = 'DISCARDED' then raise exception 'QB_BATCH_ALREADY_DISCARDED'; end if;
  if exists (select 1 from public.question_batch_approvals a where a.batch_id = b.id and a.status = 'ACTIVE') then raise exception 'QB_BATCH_IS_LIVE'; end if;
  if length(v_note) < 10 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  if b.status <> 'DISCARDING' then   -- first step: from here the batch accepts no more rows and cannot be approved; it is only being withdrawn
    update public.question_load_batches set status = 'DISCARDING', report = coalesce(report, '{}'::jsonb) || jsonb_build_object('status_before_discard', b.status) where id = b.id;
  end if;
  select array_agg(s.id) into ids from (
    select q.id from public.questions q
     where public.qb_ql_batches(q.tags) @> array[b.id] and not (q.status::text = 'archived' and q.validation_status = 'rejected')
     order by q.id limit lim) s;
  n := coalesce(cardinality(ids), 0);
  if n > 0 then
    -- The review guard refuses `rejected` to anyone without a subject domain; this function is the owner's, so it sets the same transaction-local flag the approval uses.
    perform set_config('quizbox.owner_batch', 'on', true);
    update public.questions q set status = 'archived', validation_status = 'rejected',
           editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('discarded_batch', b.id, 'discard_note', v_note)
     where q.id = any(ids);
    perform set_config('quizbox.owner_batch', 'off', true);
  end if;
  if n < lim then
    select count(*)::integer into withdrawn from public.questions q where public.qb_ql_batches(q.tags) @> array[b.id] and q.editorial_metadata ->> 'discarded_batch' = b.id::text;
    update public.question_load_batches
       set status = 'DISCARDED', completed_at = coalesce(completed_at, now()),
           file_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(b.file_sha256 || ':' || b.id::text, 'UTF8')), 'hex'),
           report = coalesce(report, '{}'::jsonb) || jsonb_build_object('discarded_by', auth.uid(), 'discarded_at', now(), 'discard_note', v_note, 'original_file_sha256', b.file_sha256, 'questions_withdrawn', withdrawn)
     where id = b.id;
    return jsonb_build_object('batch_id', b.id, 'done', true, 'withdrawn', withdrawn);
  end if;
  return jsonb_build_object('batch_id', b.id, 'done', false, 'withdrawn_now', n);
end $fn$;

revoke all on function public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer), public.qb_owner_revoke_batch_approval_step(uuid, text, integer),
  public.qb_owner_batch_discard_step(uuid, text, integer) from public, anon;
grant execute on function public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer), public.qb_owner_revoke_batch_approval_step(uuid, text, integer),
  public.qb_owner_batch_discard_step(uuid, text, integer) to authenticated;

commit;
