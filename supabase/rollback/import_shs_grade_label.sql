-- Puts the question import's grade line back as it was (SHS question loads will stop again with the "SHS 1" enum error).
begin;
do $$
declare
  body text;
  old_expr text := 'coalesce(n.source_grade_code,n.grade_code)::public.qb_grade';
  new_expr text := 'case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end';
begin
  body := pg_get_functiondef('quizbox_private.core_qb_content_ingest(jsonb,jsonb,text,text,text)'::regprocedure);
  if position(new_expr in body) = 0 then return; end if;
  execute replace(body, new_expr, old_expr);
end $$;
commit;
