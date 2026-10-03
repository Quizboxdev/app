-- public.sme_review_queue is a security_invoker view that evaluates quizbox_sme.domain_matches for the
-- caller; without execute the view fails for every reviewer and content admin. The predicate only
-- returns whether a domain matches; row visibility stays with the view filter and RLS.
begin;
grant usage on schema quizbox_sme to authenticated;
grant execute on function quizbox_sme.domain_matches(uuid,uuid,uuid,uuid,boolean,boolean) to authenticated;
commit;
