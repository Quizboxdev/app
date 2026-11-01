-- Owner batch actions in small, resumable steps, and a Discard that works against the real rules.
-- Why: approving, revoking or discarding a batch updated EVERY question of the batch in one statement. Each updated question fires several row triggers (editorial guard,
-- version snapshot, audit row, market guard), so a batch of a thousand or more questions ran past the database's statement time limit and the screen showed only
-- "The operation could not be completed". Batches of about 650 happened to fit; 1,250 and 1,400 did not.
-- What this adds (additive; the original single-call functions stay in place):
--   * qb_owner_approve_batch_step(batch, note, sample_reviewed, publish, limit)   approves the next `limit` valid questions; the approval is recorded on the first step and
--     marked in_progress until the last one; calling it again simply continues, so an interrupted approval is finished, never repeated.
--   * qb_owner_revoke_batch_approval_step(approval, note, limit)                  returns the next `limit` questions to review; the approval is REVOKED on the last step.
--   * qb_owner_batch_discard_step(batch, note, limit)                              withdraws the next `limit` questions of a batch; the batch is DISCARDING until the last step,
--     then DISCARDED with its file fingerprint released. It replaces qb_owner_batch_discard(uuid, text) from 20261051100000, which could not work on the real tables:
--     the batch status check did not allow DISCARDED, and the review guard refuses `rejected` unless the owner flag is set.
-- Each step is one short transaction. A step that is cut off changes nothing, and the same call is simply sent again.
-- Rollback: supabase/rollback/owner_batch_steps.sql.
begin;

-- The batch status list gains DISCARDING and DISCARDED (whatever the old check was called, it is replaced).
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.question_load_batches'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.question_load_batches drop constraint %I', c);
  end loop;
end $$;
alter table public.question_load_batches add constraint question_load_batches_status_check
  check (status in ('CHECKED', 'LOADING', 'LOADED', 'PARTIAL', 'FAILED', 'REJECTED', 'DISCARDING', 'DISCARDED'));

alter table public.question_batch_approvals add column if not exists in_progress boolean not null default false;

create or replace function public.qb_owner_approve_batch_step(p_batch uuid, p_note text, p_sample_reviewed integer, p_publish boolean default true, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; a public.question_batch_approvals; tag text; ids uuid[]; n integer; found integer; total integer; lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status not in ('LOADED', 'PARTIAL') then raise exception 'QB_BATCH_NOT_LOADED'; end if;
  select * into a from public.question_batch_approvals where batch_id = b.id and status = 'ACTIVE';
  if a.id is not null and not a.in_progress then raise exception 'QB_BATCH_ALREADY_APPROVED'; end if;
  if a.id is null then   -- first step: the sample and the note are checked and recorded once; later steps just continue this approval
    if p_sample_reviewed is null or p_sample_reviewed < 20 then raise exception 'QB_OWNER_SAMPLE_TOO_SMALL'; end if;
    if length(btrim(coalesce(p_note, ''))) not between 10 and 1000 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
    insert into public.question_batch_approvals(batch_id, approved_by, note, sample_reviewed, published, in_progress)
    values (b.id, auth.uid(), btrim(p_note), p_sample_reviewed, coalesce(p_publish, true), true) returning * into a;
  end if;
  tag := 'source:QL:' || b.id || ':%';
  select array_agg(s.id) into ids from (
    select q.id from public.questions q
     where exists (select 1 from unnest(q.tags) t where t like tag) and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb
     order by q.id limit lim) s;
  n := coalesce(cardinality(ids), 0);
  if n > 0 then
    -- Only this function sets the flag, for this transaction only, after the super-admin check above.
    perform set_config('quizbox.owner_batch', 'on', true);
    update public.questions q set validation_status = 'approved', status = 'inactive', reviewed_by = auth.uid(), reviewed_at = now(),
           editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('human_reviewed', true, 'approval_basis', 'OWNER_BATCH', 'approval_id', a.id,
                                  'review_note', 'Owner-approved batch after a sample read (not subject-expert reviewed)')
     where q.id = any(ids);
    if a.published then update public.questions set status = 'active' where id = any(ids); end if;
    perform set_config('quizbox.owner_batch', 'off', true);
  end if;
  total := coalesce(a.questions_approved, 0) + n;
  if n < lim then   -- fewer than a full step left: this was the last one
    select count(*)::integer into found from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag);
    update public.question_batch_approvals set questions_approved = total, questions_skipped = greatest(found - total, 0), in_progress = false where id = a.id returning * into a;
    return jsonb_build_object('approval_id', a.id, 'done', true, 'questions_found', found, 'approved', total, 'skipped', greatest(found - total, 0), 'published', a.published);
  end if;
  update public.question_batch_approvals set questions_approved = total where id = a.id;
  return jsonb_build_object('approval_id', a.id, 'done', false, 'approved', total, 'published', a.published);
end $fn$;

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
    select q.id from public.questions q where q.editorial_metadata ->> 'approval_id' = a.id::text and q.validation_status = 'approved' order by q.id limit lim) s;
  n := coalesce(cardinality(ids), 0);
  if n > 0 then
    update public.questions q set validation_status = 'review', status = 'inactive', reviewed_by = null, reviewed_at = null,
           editorial_metadata = (coalesce(q.editorial_metadata, '{}'::jsonb) - 'human_reviewed' - 'approval_basis' - 'approval_id' - 'review_note') || jsonb_build_object('owner_approval_revoked', a.id)
     where q.id = any(ids);
  end if;
  select count(*)::integer into returned from public.questions q where q.editorial_metadata ->> 'owner_approval_revoked' = a.id::text;
  if n < lim then
    update public.question_batch_approvals set status = 'REVOKED', in_progress = false, revoked_at = now(), revoked_by = auth.uid(), revoke_note = btrim(p_note) where id = a.id;
    return jsonb_build_object('approval_id', a.id, 'done', true, 'returned_to_review', returned);
  end if;
  return jsonb_build_object('approval_id', a.id, 'done', false, 'returned_to_review', returned);
end $fn$;

drop function if exists public.qb_owner_batch_discard(uuid, text);
create or replace function public.qb_owner_batch_discard_step(p_batch uuid, p_note text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; ids uuid[]; n integer; withdrawn integer; v_note text := left(btrim(coalesce(p_note, '')), 500); lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
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
  tag := 'source:QL:' || b.id || ':%';
  select array_agg(s.id) into ids from (
    select q.id from public.questions q
     where exists (select 1 from unnest(q.tags) t where t like tag) and not (q.status::text = 'archived' and q.validation_status = 'rejected')
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
    select count(*)::integer into withdrawn from public.questions q where q.editorial_metadata ->> 'discarded_batch' = b.id::text;
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
