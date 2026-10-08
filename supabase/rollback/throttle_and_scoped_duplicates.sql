-- Rollback for 20261009100000_throttle_and_scoped_duplicates.sql. Restores the previous (defective) behavior; use only if the migration must be reverted.
begin;
create or replace function public.qb_start_attempt(p_assessment_id uuid, p_assignment_id uuid, p_class_id uuid, p_client_session_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin if not quizbox_market.assessment_allowed(p_assessment_id) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
 if not quizbox_private.consume_budget('qb_start_attempt',10,60) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  return quizbox_private.core_qb_start_attempt(p_assessment_id,p_assignment_id,p_class_id,p_client_session_id);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

do $rollback$
declare body text;
 old_lookup constant text := $old$select coalesce(duplicate_group_id,'dup-'||text_hash) into dup from public.questions where text_hash=encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex') limit 1;$old$;
 old_update constant text := $old$update public.questions set duplicate_group_id=dup where text_hash=inserted.text_hash;$old$;
 new_lookup_start constant text := 'select coalesce(q.duplicate_group_id,''dup-''||q.text_hash) into dup from public.questions q join public.curricula qc';
 new_update_start constant text := 'update public.questions u set duplicate_group_id=dup from public.curricula uc';
 a int; b int;
begin
 body:=pg_get_functiondef('quizbox_private.core_qb_content_ingest(jsonb,jsonb,text,text,text)'::regprocedure);
 a:=position(new_lookup_start in body); b:=position(new_update_start in body);
 if a=0 or b=0 then return; end if; -- scoped version not present
 -- cut each scoped statement (ends at its terminating ';' after 'limit 1' / 'question_allowed(u.id));') and restore the original text
 body:=regexp_replace(body, 'select coalesce\(q\.duplicate_group_id.*?order by q\.id limit 1;', replace(old_lookup,'\','\'), 'n');
 body:=regexp_replace(body, 'update public\.questions u set duplicate_group_id=dup from public\.curricula uc.*?question_allowed\(u\.id\)\);', replace(old_update,'\','\'), 'n');
 execute body;
end $rollback$;
commit;
