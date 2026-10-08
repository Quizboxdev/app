-- Rollback for 20261010100000_admin_rpc_budget_order.sql. Restores the previous wrapper bodies (gate BEFORE the rate budget and outside the protected block).
-- This re-introduces the defect that denied calls are not throttled; use only if the migration must be reverted. ACLs are unchanged by both directions.
begin;

create or replace function public.qb_content_ingest(p_spec jsonb, p_candidates jsonb, p_source_file text default 'candidate.json'::text, p_provider text default 'human'::text, p_model text default null::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin p_spec:=quizbox_market.generation_context(p_spec);
 if not quizbox_private.consume_budget('qb_content_ingest',20,3600) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  return quizbox_private.core_qb_content_ingest(p_spec,p_candidates,p_source_file,p_provider,p_model);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

create or replace function public.qb_content_request_generation(p_spec jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin p_spec:=quizbox_market.generation_context(p_spec);
 if not quizbox_private.consume_budget('qb_content_request_generation',10,3600) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  return quizbox_private.core_qb_content_request_generation(p_spec);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

create or replace function public.qb_content_review(p_id uuid, p_action text, p_version integer, p_expected_state text, p_patch jsonb default '{}'::jsonb, p_note text default ''::text, p_human_reviewed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin perform quizbox_market.assert_question(p_id);
 if not quizbox_private.consume_budget('qb_content_review',120,60) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  return quizbox_private.core_qb_content_review(p_id,p_action,p_version,p_expected_state,p_patch,p_note,p_human_reviewed);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

commit;
