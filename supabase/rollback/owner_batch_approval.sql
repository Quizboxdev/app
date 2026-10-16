-- Rollback for 20261014110000_owner_batch_approval: restores the original review guard and removes the owner-batch objects.
-- Questions already approved through an owner batch keep their approved state; revoke each approval FIRST if you want them back in review.
begin;
drop function if exists public.qb_owner_revoke_batch_approval(uuid, text);
drop function if exists public.qb_owner_approve_batch(uuid, text, integer, boolean);
drop function if exists public.qb_owner_batch_preview(uuid);
create or replace function quizbox_sme.managed_review_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
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
end $$;
drop table if exists public.question_batch_approvals;
commit;
