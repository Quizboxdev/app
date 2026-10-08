begin;

-- A. qb_start_attempt: charge the rate budget BEFORE the market/content gate, and raise the gate inside the protected block.
-- consume_budget records usage with an INSERT. An exception raised outside the inner block aborts the statement and rolls that
-- INSERT back, so denied starts used to leave no trace and were never throttled. Inside the block the exception becomes the same
-- jsonb failure payload every other failure uses, the transaction commits, and the budget persists. Authorization is unchanged
-- (same QB_CONTENT_SOURCE_DENIED / 42501 / HTTP 403). The budget is charged before any lookup, so the throttle point is identical
-- for existing, unauthorized and non-existent assessments and leaks nothing about content existence.
create or replace function public.qb_start_attempt(p_assessment_id uuid, p_assignment_id uuid, p_class_id uuid, p_client_session_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin
 if not quizbox_private.consume_budget('qb_start_attempt',10,60) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  if not quizbox_market.assessment_allowed(p_assessment_id) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
  return quizbox_private.core_qb_start_attempt(p_assessment_id,p_assignment_id,p_class_id,p_client_session_id);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

-- B. Content Factory ingest: scope duplicate detection and grouping to the allowed market scope.
-- Before: the duplicate lookup and the grouping UPDATE matched text_hash across the whole database, so identical text in another
-- market (a) revealed that question through the staging classification and (b) made the grouping UPDATE touch rows the caller is
-- not authorized for, failing ingest with QB_CONTENT_SOURCE_DENIED. Now both match only platform (tenant-less) questions in the
-- SAME MARKET as the target curriculum that the caller is allowed to see (question_allowed). Duplicates inside that scope are
-- detected and grouped exactly as before; nothing outside it is read or mutated.
do $migration$
declare body text;
 old_lookup constant text := $old$select coalesce(duplicate_group_id,'dup-'||text_hash) into dup from public.questions where text_hash=encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex') limit 1;$old$;
 new_lookup constant text := $new$select coalesce(q.duplicate_group_id,'dup-'||q.text_hash) into dup from public.questions q join public.curricula qc on qc.id=q.curriculum_id where q.text_hash=encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex') and q.tenant_id is null and qc.market_id=(select c.market_id from public.curriculum_nodes nn join public.curricula c on c.id=nn.curriculum_id where nn.id=case when candidate->>'curriculum_node_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (candidate->>'curriculum_node_id')::uuid end) and quizbox_market.question_allowed(q.id) order by q.id limit 1;$new$;
 old_update constant text := $old$update public.questions set duplicate_group_id=dup where text_hash=inserted.text_hash;$old$;
 new_update constant text := $new$update public.questions u set duplicate_group_id=dup from public.curricula uc where uc.id=u.curriculum_id and u.text_hash=inserted.text_hash and u.tenant_id is null and uc.market_id=(select c.market_id from public.curricula c where c.id=inserted.curriculum_id) and (u.id=inserted.id or quizbox_market.question_allowed(u.id));$new$;
begin
 body:=pg_get_functiondef('quizbox_private.core_qb_content_ingest(jsonb,jsonb,text,text,text)'::regprocedure);
 if position(new_lookup in body)>0 and position(new_update in body)>0 then return; end if; -- already applied (idempotent)
 if position(old_lookup in body)=0 or position(old_update in body)=0 then raise exception 'INGEST_DUPLICATE_CONTRACT_MISMATCH'; end if;
 body:=replace(replace(body,old_lookup,new_lookup),old_update,new_update);
 execute body;
end $migration$;

commit;
