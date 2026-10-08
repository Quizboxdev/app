begin;

-- Throttle-order consistency for the admin content RPCs (same pattern as qb_start_attempt, migration 20261009100000).
-- Before: each function ran its market/content gate BEFORE consume_budget and outside the protected block. consume_budget records usage with
-- an INSERT; an exception raised outside the inner block aborts the statement and rolls that INSERT back, so denied calls left no trace and
-- were never throttled. Now the budget is charged first (uniformly, before any lookup, so the throttle reveals nothing about whether a
-- question/curriculum exists) and the gate runs inside the protected block, where its exception becomes the same jsonb failure payload
-- as every other failure and the budget row commits. The gate itself, its error codes and HTTP statuses (403 for 42501, otherwise 400) are unchanged.

create or replace function public.qb_content_ingest(p_spec jsonb, p_candidates jsonb, p_source_file text default 'candidate.json'::text, p_provider text default 'human'::text, p_model text default null::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare failure text;
begin
 if not quizbox_private.consume_budget('qb_content_ingest',20,3600) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  p_spec:=quizbox_market.generation_context(p_spec);
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
begin
 if not quizbox_private.consume_budget('qb_content_request_generation',10,3600) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  p_spec:=quizbox_market.generation_context(p_spec);
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
begin
 if not quizbox_private.consume_budget('qb_content_review',120,60) then
  perform set_config('response.status','429',true);
  return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
 end if;
 begin
  perform quizbox_market.assert_question(p_id);
  return quizbox_private.core_qb_content_review(p_id,p_action,p_version,p_expected_state,p_patch,p_note,p_human_reviewed);
 exception when others then
  failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
  perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
  return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
 end;
end $$;

-- CREATE OR REPLACE keeps each function's ACL (postgres, service_role, authenticated); nothing is granted or revoked here.

commit;
