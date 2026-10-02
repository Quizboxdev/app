begin;
do $bounds$
declare body text; fn text;
begin
 foreach fn in array array['public.qb_content_queue(jsonb,integer,integer)','public.qb_content_coverage(jsonb,integer,integer,integer)'] loop
  body:=pg_get_functiondef(fn::regprocedure);
  body:=replace(body,'if p_page<1 or p_limit not between 1 and 100', 'if p_page is null or p_page<1 or p_page>100000 or p_limit is null or p_limit not between 1 and 100');
  body:=replace(body,'or p_target not between 1 and 1000','or p_target is null or p_target not between 1 and 1000');
  execute body;
 end loop;
end $bounds$;
notify pgrst,'reload schema';
commit;
