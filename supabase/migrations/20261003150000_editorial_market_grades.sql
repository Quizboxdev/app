-- The editorial guard copies a node's grade into the legacy national enum; other markets' grade
-- codes are kept in source/canonical grade columns only.
begin;
do $$ declare body text; old_expr text:='new.grade:=coalesce(n.source_grade_code,n.grade_code)::public.qb_grade;'; begin
 body:=pg_get_functiondef('public.qb_question_editorial_guard()'::regprocedure);
 if position(old_expr in body)=0 then raise exception 'EDITORIAL_GRADE_CONTRACT_MISMATCH'; end if;
 body:=replace(body,old_expr,'new.grade:=case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end;');
 execute body;
end $$;
commit;
