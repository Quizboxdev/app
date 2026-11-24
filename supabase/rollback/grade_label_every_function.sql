-- Puts the unguarded grade cast back in every QuizBox function that has the guarded form (SHS question loads will stop again with the "SHS 1" enum error).
begin;
do $$
declare
  f record; body text;
  old_expr text := 'coalesce(n.source_grade_code,n.grade_code)::public.qb_grade';
  new_expr text := 'case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end';
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where p.prokind = 'f' and s.nspname in ('public','quizbox_private','quizbox_factory','quizbox_competition','quizbox_market') loop
    body := pg_get_functiondef(f.oid);
    if position(new_expr in body) = 0 then continue; end if;
    execute replace(body, new_expr, old_expr);
  end loop;
end $$;
commit;
