-- Owner batch steps, fast. The approve, revoke and discard steps found a batch's questions by scanning the whole questions table (a tag pattern, and a JSON field), and the approve step validated every question of the batch on every step.
-- On 36,000+ questions a step took several seconds and sometimes hit the database time limit (57014). They now use the index from 20261072100000 and validate only until a full step is found.
-- Same behaviour, same results, same permissions. Rollback: supabase/rollback/owner_batch_steps_fast.sql (the previous definitions).
begin;

create or replace function public.qb_owner_approve_batch_step(p_batch uuid, p_note text, p_sample_reviewed integer, p_publish boolean default true, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; a public.question_batch_approvals; ids uuid[] := '{}'; r record; n integer; found integer; total integer; lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
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
  -- The batch's questions come through the index on the batch tag, and validation runs only until a full step is found (not on the whole batch every step).
  for r in select q.id from public.questions q where public.qb_ql_batches(q.tags) @> array[b.id] and q.validation_status = 'review' order by q.id loop
    if public.qb_content_validation_errors((select to_jsonb(x) from public.questions x where x.id = r.id)) = '[]'::jsonb then
      ids := ids || r.id;
      exit when cardinality(ids) >= lim;
    end if;
  end loop;
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
    select count(*)::integer into found from public.questions q where public.qb_ql_batches(q.tags) @> array[b.id];
    update public.question_batch_approvals set questions_approved = total, questions_skipped = greatest(found - total, 0), in_progress = false where id = a.id returning * into a;
    return jsonb_build_object('approval_id', a.id, 'done', true, 'questions_found', found, 'approved', total, 'skipped', greatest(found - total, 0), 'published', a.published);
  end if;
  update public.question_batch_approvals set questions_approved = total where id = a.id;
  return jsonb_build_object('approval_id', a.id, 'done', false, 'approved', total, 'published', a.published);
end $fn$;
