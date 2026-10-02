begin;
alter table public.questions add constraint questions_editorial_state_check check (validation_status is not null and validation_status in ('draft','generated','review','approved','rejected','needs_revision')) not valid;
alter table public.questions validate constraint questions_editorial_state_check;
create or replace function public.qb_content_batches(p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if p_page is null or p_page<1 or p_page>100000 or p_limit is null or p_limit not between 1 and 100 then raise exception 'QB_INVALID_PAGE'; end if;
 select jsonb_build_object('total',(select count(*) from public.content_import_batches),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (
 select b.id,b.source_file,b.status,b.started_at,b.imported_by,b.records_detected,b.valid_records,b.rejected_records,b.inserted_records,b.duplicates_skipped,b.source_type,b.provider,b.model_version,b.generation_spec,b.report,
 (select count(*) from public.questions q where q.import_batch_id=b.id and q.validation_status='approved') approved_records,
 (select count(*) from public.questions q where q.import_batch_id=b.id and q.validation_status in ('draft','generated','review','needs_revision')) pending_records,
 (select count(*) from public.questions q where q.import_batch_id=b.id and q.validation_status='rejected') rejected_editorial_records
 from public.content_import_batches b order by b.started_at desc,b.id limit p_limit offset (p_page-1)*p_limit
 ) r),'[]'::jsonb)) into result;
 return result;
end $function$;
revoke all on function public.qb_content_batches(integer,integer) from public,anon;
grant execute on function public.qb_content_batches(integer,integer) to authenticated;
do $input$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_content_ingest(jsonb,jsonb,text,text,text)'::regprocedure);
 body:=replace(body,'if jsonb_typeof(p_candidates)<>''array''','if jsonb_typeof(p_spec) is distinct from ''object'' or jsonb_typeof(p_candidates) is distinct from ''array''');
 execute body;
end $input$;
notify pgrst,'reload schema';
commit;
