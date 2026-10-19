-- Rollback for 20261018150000_public_interest_intake. Refuses to drop the submissions table if it holds rows (export them first).
begin;
drop function if exists public.qb_admin_public_interest(text, jsonb);
drop function if exists public.qb_submit_public_interest(jsonb, text);
drop function if exists quizbox_private.submit_public_interest(jsonb, text);
drop function if exists quizbox_private.intake_metadata_ok(text, jsonb);
drop function if exists quizbox_private.consume_intake_budget(text, integer, integer);
drop table if exists quizbox_private.intake_budgets;
do $chk$ begin
  if to_regclass('quizbox_private.public_interest_submissions') is not null and exists (select 1 from quizbox_private.public_interest_submissions) then
    raise exception 'QB_ROLLBACK_REFUSED: submissions exist; export them first';
  end if;
end $chk$;
drop table if exists quizbox_private.public_interest_submissions;
commit;
