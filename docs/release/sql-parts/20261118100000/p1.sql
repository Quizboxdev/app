-- A batch can now be approved on a second, honest basis: SCRIPT_CHECKED. It is for the scheduled loader (scripts/question-bank/auto-load.ts), which checks a random sample of 20 with rules and no person reads it.
-- Until now the only approval was OWNER_BATCH, which stamps every question human_reviewed = true ("Owner-approved batch after a sample read"). That stamp would be untrue for a script, so a script approval is recorded differently:
--   * question_batch_approvals.basis = 'SCRIPT_CHECKED' (default stays 'OWNER_BATCH'),
--   * the questions carry approval_basis = 'SCRIPT_CHECKED', human_reviewed = false and a review_note saying no person read the sample and no subject expert reviewed it.
-- Learners and the review screens therefore never see these as human-reviewed. Revoke works exactly as before (one batch, one click).
-- The editorial guard asks for human_reviewed = true on every newly approved question. It gets ONE exception, usable only inside the owner-batch functions (transaction-local flag, set after a super-admin check):
-- approval_basis = 'SCRIPT_CHECKED'. Nothing outside those functions can set that flag, so no other path can approve without a human review.
-- The approve step gains an optional last argument p_basis (default 'OWNER_BATCH'); the Admin > Question batches screen is unchanged and keeps calling it without that argument.
-- Rollback: supabase/rollback/script_checked_batch_approval.sql
begin;

alter table public.question_batch_approvals add column if not exists basis text not null default 'OWNER_BATCH';
alter table public.question_batch_approvals drop constraint if exists question_batch_approvals_basis_check;
alter table public.question_batch_approvals add constraint question_batch_approvals_basis_check check (basis in ('OWNER_BATCH', 'SCRIPT_CHECKED'));

do $$ declare body text; old_expr text := 'new.editorial_metadata->>''human_reviewed'' is distinct from ''true'' then raise exception ''QB_HUMAN_REVIEW_REQUIRED''';
begin
  body := pg_get_functiondef('public.qb_question_editorial_guard()'::regprocedure);
  if position('SCRIPT_CHECKED' in body) > 0 then return; end if;   -- already patched (safe to apply twice)
  if position(old_expr in body) = 0 then raise exception 'EDITORIAL_GUARD_CONTRACT_MISMATCH'; end if;
  body := replace(body, old_expr, '(new.editorial_metadata->>''human_reviewed'' is distinct from ''true'' and not (new.editorial_metadata->>''approval_basis'' = ''SCRIPT_CHECKED'' and current_setting(''quizbox.owner_batch'', true) = ''on'' and quizbox_market.is_super())) then raise exception ''QB_HUMAN_REVIEW_REQUIRED''');
  execute body;
end $$;

drop function if exists public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer);
create or replace function public.qb_owner_approve_batch_step(p_batch uuid, p_note text, p_sample_reviewed integer, p_publish boolean default true, p_limit integer default 100, p_basis text default 'OWNER_BATCH') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; a public.question_batch_approvals; ids uuid[] := '{}'; r record; n integer; found integer; total integer; lim integer := least(greatest(coalesce(p_limit, 100), 1), 500); human boolean;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if coalesce(p_basis, 'OWNER_BATCH') not in ('OWNER_BATCH', 'SCRIPT_CHECKED') then raise exception 'QB_APPROVAL_BASIS_INVALID'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status not in ('LOADED', 'PARTIAL') then raise exception 'QB_BATCH_NOT_LOADED'; end if;
  select * into a from public.question_batch_approvals where batch_id = b.id and status = 'ACTIVE';
  if a.id is not null and not a.in_progress then raise exception 'QB_BATCH_ALREADY_APPROVED'; end if;
  if a.id is null then   -- first step: the sample and the note are checked and recorded once; later steps just continue this approval
    if p_sample_reviewed is null or p_sample_reviewed < 20 then raise exception 'QB_OWNER_SAMPLE_TOO_SMALL'; end if;
    if length(btrim(coalesce(p_note, ''))) not between 10 and 1000 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
    insert into public.question_batch_approvals(batch_id, approved_by, note, sample_reviewed, published, in_progress, basis)
    values (b.id, auth.uid(), btrim(p_note), p_sample_reviewed, coalesce(p_publish, true), true, coalesce(p_basis, 'OWNER_BATCH')) returning * into a;
  end if;
  human := a.basis = 'OWNER_BATCH';   -- a continuing step keeps the basis the approval started with
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
           editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('human_reviewed', human, 'approval_basis', a.basis, 'approval_id', a.id,
                                  'review_note', case when human then 'Owner-approved batch after a sample read (not subject-expert reviewed)'
                                                      else 'Approved by an automated sample check. No person read the sample and no subject expert reviewed it' end)
     where q.id = any(ids);
    if a.published then update public.questions set status = 'active' where id = any(ids); end if;
    perform set_config('quizbox.owner_batch', 'off', true);
  end if;
  total := coalesce(a.questions_approved, 0) + n;
  if n < lim then   -- fewer than a full step left: this was the last one
    select count(*)::integer into found from public.questions q where public.qb_ql_batches(q.tags) @> array[b.id];
    update public.question_batch_approvals set questions_approved = total, questions_skipped = greatest(found - total, 0), in_progress = false where id = a.id returning * into a;
    return jsonb_build_object('approval_id', a.id, 'done', true, 'questions_found', found, 'approved', total, 'skipped', greatest(found - total, 0), 'published', a.published, 'basis', a.basis);
  end if;
  update public.question_batch_approvals set questions_approved = total where id = a.id;
  return jsonb_build_object('approval_id', a.id, 'done', false, 'approved', total, 'published', a.published, 'basis', a.basis);
end $fn$;

revoke all on function public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer, text) from public, anon;
grant execute on function public.qb_owner_approve_batch_step(uuid, text, integer, boolean, integer, text) to authenticated;

commit;
