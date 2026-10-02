begin;
grant select(curriculum_id,difficulty_code,marks,estimated_time_seconds) on public.questions to authenticated;
alter table public.assessment_questions add column source_type_snapshot text;
alter table public.assessment_questions add column question_version_snapshot integer;
alter table public.assessment_questions add column editorial_approved_snapshot boolean not null default false;
-- Certify only currently approved, mapped snapshots whose frozen content matches.
update public.assessment_questions aq set source_type_snapshot=q.source_type,question_version_snapshot=q.version,
 editorial_approved_snapshot=(q.status='active' and q.validation_status='approved'
 and exists(select 1 from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active and n.node_type in ('learning_indicator','learning_objective'))
 and (q.source_type='DEV_ACCEPTANCE_FIXTURE' or public.qb_content_validation_errors(to_jsonb(q))='[]'::jsonb)
 and aq.question_text_snapshot is not distinct from q.question_text
 and aq.correct_answer_snapshot is not distinct from q.correct_answer)
from public.questions q where q.id=aq.question_id;
do $proof$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_snapshot_assessment_question()'::regprocedure);
 body:=replace(body,'return new;', $fragment$
 if tg_op='INSERT' then
  new.source_type_snapshot:=q.source_type;
  new.question_version_snapshot:=q.version;
  new.editorial_approved_snapshot:=coalesce(public.qb_question_is_available(q),false);
 else
  new.source_type_snapshot:=old.source_type_snapshot;
  new.question_version_snapshot:=old.question_version_snapshot;
  new.editorial_approved_snapshot:=old.editorial_approved_snapshot;
 end if;
 return new;$fragment$);
 execute body;
 body:=pg_get_functiondef('public.qb_can_access_learning_assessment(uuid)'::regprocedure);
 body:=replace(body,' and (a.tenant_id=', $fragment$
 and not exists(select 1 from public.assessment_questions aq where aq.assessment_id=a.id
 and (not aq.editorial_approved_snapshot and not (coalesce(aq.source_type_snapshot,'') in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') and public.qb_is_acceptance_actor())
 or coalesce(aq.source_type_snapshot,'') in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') and not public.qb_is_acceptance_actor()))
 and (a.tenant_id=$fragment$);
 execute body;
end $proof$;
notify pgrst,'reload schema';
commit;
