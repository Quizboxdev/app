-- Owner-approved batch (interim review path). Until reviewer coverage exists, the platform owner can approve a LOADED question batch after reading a sample.
-- Honest by design: every question approved this way carries editorial_metadata.approval_basis = 'OWNER_BATCH' and the approval id, so it is never shown
-- or counted as subject-expert reviewed (decision D-7), and the whole approval can be revoked, which returns its questions to review for the SME pool.
--   qb_owner_batch_preview(batch)                          read-only: what an approval would do (counts, validation, availability, a random sample to read)
--   qb_owner_approve_batch(batch, note, sample_reviewed, publish default true)   super admin only; needs a sample count (a fixed minimum of 20 questions read)
--   qb_owner_revoke_batch_approval(approval, note)         super admin only; questions go back to review and offline
-- The review guard (quizbox_sme.managed_review_guard) is replaced with a copy that adds ONE exception: the transaction-local flag quizbox.owner_batch
-- = 'on', which only qb_owner_approve_batch sets after it has verified the caller is a super admin. Everything else in the guard is unchanged.
-- Rollback restores the original guard and drops the new objects.
begin;

create table if not exists public.question_batch_approvals (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.question_load_batches(id),
  basis text not null default 'OWNER_BATCH' check (basis = 'OWNER_BATCH'),
  approved_by uuid not null references public.profiles(id),
  note text not null check (length(btrim(note)) between 10 and 1000),
  sample_reviewed integer not null check (sample_reviewed >= 1),
  questions_approved integer not null default 0 check (questions_approved >= 0),
  questions_skipped integer not null default 0 check (questions_skipped >= 0),
  published boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz, revoked_by uuid references public.profiles(id), revoke_note text
);
create unique index if not exists question_batch_approvals_one_active on public.question_batch_approvals(batch_id) where status = 'ACTIVE';
alter table public.question_batch_approvals enable row level security;
revoke all on public.question_batch_approvals from public, anon, authenticated;
drop policy if exists question_batch_approvals_admin_read on public.question_batch_approvals;
create policy question_batch_approvals_admin_read on public.question_batch_approvals for select to authenticated using (quizbox_sme.has_capability('content_admin') or quizbox_market.is_super());

create or replace function quizbox_sme.managed_review_guard() returns trigger language plpgsql security definer set search_path='' as $guard$
begin
 -- Owner-approved batch (20261014110000): only qb_owner_approve_batch sets this flag, after verifying a super admin, for its own transaction.
 if current_setting('quizbox.owner_batch', true) = 'on' and quizbox_market.is_super() then return new; end if;
 -- Admin role alone never confers subject-review permission. Legacy history is untouched.
 if new.version=old.version and new.validation_status is distinct from old.validation_status and new.validation_status in ('approved','rejected','needs_revision')
 and not exists(select 1 from public.sme_domain_assignments d where d.reviewer_id=auth.uid()
  and quizbox_sme.domain_matches(d.id,old.id,auth.uid(),(select market_id from public.curricula where id=old.curriculum_id),false,new.validation_status='approved')) then
  raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501';
 end if;
 if new.validation_status is distinct from old.validation_status and exists(select 1 from public.sme_review_assignments where question_id=old.id and review_completed_at is null)
 and not exists(select 1 from public.sme_review_assignments where id::text=current_setting('quizbox.sme_assignment',true) and question_id=old.id and reviewer_id=auth.uid()) then
  raise exception 'QB_ASSIGNED_REVIEW_REQUIRED' using errcode='42501';
 end if;
 if new.status::text='active' and old.status::text<>'active' and exists(select 1 from public.sme_review_assignments where question_id=old.id) then
  if not (quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('competition_admin')) then raise exception 'QB_SME_PUBLISH_DENIED' using errcode='42501'; end if;
  if exists(select 1 from public.sme_review_assignments where question_id=old.id and review_completed_at is null) then raise exception 'QB_PENDING_SME_REVIEW'; end if;
  if exists(select 1 from public.curricula c join public.markets m on m.id=c.market_id where c.id=new.curriculum_id and coalesce((m.configuration->>'require_senior_qa')::boolean,false))
  and not exists(select 1 from public.sme_review_assignments w join public.sme_review_events e on e.assignment_id=w.id where w.question_id=new.id and w.question_version=new.version and w.review_kind='senior' and e.decision='approve'
   and e.review_completed_at>=coalesce((select max(a.review_completed_at) from public.sme_review_assignments a where a.question_id=new.id and a.question_version=new.version and a.review_kind='primary'),'-infinity'::timestamptz)) then raise exception 'QB_SENIOR_QA_REQUIRED'; end if;
 end if;
 return new;
end $guard$;

create or replace function public.qb_owner_batch_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; total integer; by_state jsonb; valid integer; avail integer; sample jsonb;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  tag := 'source:QL:' || b.id || ':%';
  select count(*)::integer into total from public.questions q cross join lateral unnest(q.tags) t where t like tag;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into by_state from (
    select q.validation_status || '/' || q.status::text as k, count(*) as n from public.questions q
     where exists (select 1 from unnest(q.tags) t where t like tag) group by 1) s;
  select count(*)::integer into valid from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag)
     and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  select count(*)::integer into avail from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) and public.qb_question_is_available(q);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question_text, 'a', option_a, 'b', option_b, 'c', option_c, 'd', option_d, 'correct', correct_answer, 'difficulty', difficulty_label)), '[]'::jsonb)
    into sample from (select * from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) order by random() limit 20) s;
  return jsonb_build_object('batch_id', b.id, 'file', b.file_name, 'batch_status', b.status, 'questions_found', total, 'by_state', by_state,
    'would_approve', valid, 'already_available_to_learners', avail,
    'min_sample_required', 20, 'sample', sample);
end $fn$;

create or replace function public.qb_owner_approve_batch(p_batch uuid, p_note text, p_sample_reviewed integer, p_publish boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; need integer; a public.question_batch_approvals; ok_count integer; found integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status not in ('LOADED', 'PARTIAL') then raise exception 'QB_BATCH_NOT_LOADED'; end if;
  if exists (select 1 from public.question_batch_approvals where batch_id = b.id and status = 'ACTIVE') then raise exception 'QB_BATCH_ALREADY_APPROVED'; end if;
  need := 20;
  if p_sample_reviewed is null or p_sample_reviewed < need then raise exception 'QB_OWNER_SAMPLE_TOO_SMALL'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 10 and 1000 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  tag := 'source:QL:' || b.id || ':%';

  insert into public.question_batch_approvals(batch_id, approved_by, note, sample_reviewed, published)
  values (b.id, auth.uid(), btrim(p_note), p_sample_reviewed, coalesce(p_publish, true)) returning * into a;

  -- Only this function sets the flag, for this transaction only, after the super-admin check above.
  perform set_config('quizbox.owner_batch', 'on', true);
  update public.questions q set validation_status = 'approved', status = 'inactive',
         reviewed_by = auth.uid(), reviewed_at = now(),
         editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('human_reviewed', true, 'approval_basis', 'OWNER_BATCH', 'approval_id', a.id,
                                'review_note', 'Owner-approved batch after a sample read (not subject-expert reviewed)')
   where exists (select 1 from unnest(q.tags) t where t like tag) and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  get diagnostics ok_count = row_count;
  if a.published then update public.questions set status = 'active' where editorial_metadata ->> 'approval_id' = a.id::text and validation_status = 'approved'; end if;
  perform set_config('quizbox.owner_batch', 'off', true);

  select count(*)::integer into found from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag);
  update public.question_batch_approvals set questions_approved = ok_count, questions_skipped = found - ok_count where id = a.id returning * into a;
  return jsonb_build_object('approval_id', a.id, 'questions_found', found, 'approved', ok_count, 'skipped', found - ok_count, 'published', a.published);
end $fn$;

create or replace function public.qb_owner_revoke_batch_approval(p_approval uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.question_batch_approvals; n integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.question_batch_approvals where id = p_approval for update;
  if a.id is null then raise exception 'QB_APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'ACTIVE' then raise exception 'QB_APPROVAL_NOT_ACTIVE'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  update public.questions q set validation_status = 'review', status = 'inactive', reviewed_by = null, reviewed_at = null,
         editorial_metadata = (coalesce(q.editorial_metadata, '{}'::jsonb) - 'human_reviewed' - 'approval_basis' - 'approval_id' - 'review_note') || jsonb_build_object('owner_approval_revoked', a.id)
   where q.editorial_metadata ->> 'approval_id' = a.id::text and q.validation_status = 'approved';
  get diagnostics n = row_count;
  update public.question_batch_approvals set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revoke_note = btrim(p_note) where id = a.id;
  return jsonb_build_object('approval_id', a.id, 'returned_to_review', n);
end $fn$;

revoke all on function public.qb_owner_batch_preview(uuid), public.qb_owner_approve_batch(uuid, text, integer, boolean), public.qb_owner_revoke_batch_approval(uuid, text) from public, anon;
grant execute on function public.qb_owner_batch_preview(uuid), public.qb_owner_approve_batch(uuid, text, integer, boolean), public.qb_owner_revoke_batch_approval(uuid, text) to authenticated;

commit;
