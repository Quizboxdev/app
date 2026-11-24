-- Loading SHS questions stops with: invalid input value for enum public.qb_grade: "SHS 1".
-- The question import (quizbox_private.core_qb_content_ingest) copies a node's printed grade into the legacy national grade enum (B7 to B10, SHS1 to SHS3).
-- SHS curriculum nodes carry the printed form "SHS 1" in source_grade_code, which is not an enum value, so the whole load is refused before one question is saved.
-- The question editorial guard already handles this (migration 20261003150000): it fills the legacy column only when the value is in the enum and leaves it empty otherwise.
-- This applies the same rule to the import's insert. The market grade columns (source_grade_code, canonical_grade_code) are written exactly as before; only the legacy enum column is left empty for a label it cannot hold.
-- Run on a database before loading SHS questions. Safe to run again (it stops with a clear message if the function no longer has the expected line). Rollback: supabase/rollback/import_shs_grade_label.sql
begin;
do $$
declare
  body text;
  old_expr text := 'coalesce(n.source_grade_code,n.grade_code)::public.qb_grade';
  new_expr text := 'case when exists(select 1 from pg_enum where enumtypid=''public.qb_grade''::regtype and enumlabel=coalesce(n.source_grade_code,n.grade_code)) then coalesce(n.source_grade_code,n.grade_code)::public.qb_grade end';
begin
  body := pg_get_functiondef('quizbox_private.core_qb_content_ingest(jsonb,jsonb,text,text,text)'::regprocedure);
  if position(new_expr in body) > 0 then return; end if;   -- already patched
  if position(old_expr in body) = 0 then raise exception 'IMPORT_GRADE_CONTRACT_MISMATCH'; end if;
  execute replace(body, old_expr, new_expr);
end $$;
commit;
