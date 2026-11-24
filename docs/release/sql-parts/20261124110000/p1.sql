-- Follow-up to 20261124100000. SHS loads still stopped with: invalid input value for enum public.qb_grade: "SHS 3" (and "SHS 1").
-- More than one database function copies a node's printed grade ("SHS 1") into the legacy national grade enum with an unguarded cast: the question import, the question editorial guard (trigger on questions)
-- and the sponsor question delivery. Some databases have the editorial guard from before migration 20261003150000, so patching one function was not enough.
-- This finds every function in the QuizBox schemas that still has the unguarded cast and gives it the same rule: fill the legacy column only when the value is one of the enum's labels, else leave it empty.
-- The market grade columns (source_grade_code, canonical_grade_code) are untouched. Functions that already have the rule are not changed. Safe to run again. It reports each function it patched.
-- Rollback: supabase/rollback/grade_label_every_function.sql
begin;
do $$
declare
  f record; body text; patched text;
  old_expr text := 'coalesce(n.source_grade_code,n.grade_code)::public.qb_grade';
  new_expr text := 'case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end';
  keep text := '@@GUARDED_GRADE@@';
  n integer := 0;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where p.prokind = 'f' and s.nspname in ('public','quizbox_private','quizbox_factory','quizbox_competition','quizbox_market') loop
    body := pg_get_functiondef(f.oid);
    if position(old_expr in body) = 0 then continue; end if;
    patched := replace(replace(replace(body, new_expr, keep), old_expr, new_expr), keep, new_expr);
    if patched = body then continue; end if;
    execute patched;
    n := n + 1;
    raise notice 'patched %', f.sig;
  end loop;
  raise notice 'functions patched: %', n;
end $$;
commit;
