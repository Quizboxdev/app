-- Keep the durable budget outside the operation's exception subtransaction.
-- PostgREST response.status reports failure without rolling back the budget.
do $migration$
declare
 names text[]:=array['qb_start_attempt','qb_save_response','qb_save_practice_response','qb_complete_attempt','qb_submit_attempt','qb_content_request_generation','qb_content_ingest','qb_content_review'];
 f record; name text; definition text; arguments text; calls text; maximum integer; seconds integer;
begin
 for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(names) loop
  if f.prorettype<>'jsonb'::regtype then raise exception 'UNSUPPORTED_BUDGET_RETURN_CONTRACT'; end if;
  definition:=pg_get_functiondef(f.oid);
  if definition not like '%quizbox_private.enforce_budget(%' then raise exception 'BUDGET_PREFLIGHT_FAILED'; end if;
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(','FUNCTION quizbox_private.core_'||f.proname||'(');
  definition:=regexp_replace(definition,'perform quizbox_private.enforce_budget\([^;]+;','','g');
  foreach name in array names loop definition:=replace(definition,'public.'||name||'(','quizbox_private.core_'||name||'('); end loop;
  execute definition;
  execute format('revoke all on function quizbox_private.core_%I(%s) from public, anon, authenticated, service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
 -- Internal callers must retain exception propagation and all-or-nothing writes.
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not p.proname=any(names) and p.prokind='f' and p.prosrc like '%public.qb_%' loop
  definition:=pg_get_functiondef(f.oid);
  foreach name in array names loop definition:=replace(definition,'public.'||name||'(','quizbox_private.core_'||name||'('); end loop;
  if definition<>pg_get_functiondef(f.oid) then execute definition; end if;
 end loop;
 for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(names) loop
  arguments:=pg_get_function_arguments(f.oid);
  select string_agg(quote_ident(a),',' order by ord) into calls from unnest(f.proargnames) with ordinality x(a,ord);
  maximum:=case f.proname when 'qb_start_attempt' then 10 when 'qb_save_response' then 180 when 'qb_save_practice_response' then 120 when 'qb_content_request_generation' then 10 when 'qb_content_ingest' then 20 when 'qb_content_review' then 120 else 30 end;
  seconds:=case when f.proname in ('qb_content_request_generation','qb_content_ingest') then 3600 else 60 end;
  execute format($wrapper$
   create or replace function public.%I(%s) returns jsonb language plpgsql security definer set search_path='' as $body$
   declare failure text;
   begin
    if not quizbox_private.consume_budget(%L,%s,%s) then
     perform set_config('response.status','429',true);
     return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
    end if;
    begin
     return quizbox_private.core_%I(%s);
    exception when others then
     failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
     perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
     return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
    end;
   end $body$;
  $wrapper$,f.proname,arguments,f.proname,maximum,seconds,f.proname,calls);
 end loop;
end $migration$;
notify pgrst,'reload schema';
