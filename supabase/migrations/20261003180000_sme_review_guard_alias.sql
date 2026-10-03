-- The market guard injected by 20261002210000 used alias "w" inside functions that declare a variable
-- "w", making qb_sme_review_detail / qb_sme_complete_review fail (42702). The source migration is
-- corrected; this repairs databases where the earlier version was installed. No-op when already fixed.
begin;
do $$ declare f record; body text; broken text:='public.sme_review_assignments w where w.id=p_assignment and quizbox_market.question_allowed(w.question_id)'; begin
 for f in select p.oid::regprocedure sig from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('qb_sme_review_detail','qb_sme_complete_review') loop
  body:=pg_get_functiondef(f.sig);
  if position(broken in body)>0 then
   execute replace(body,broken,'public.sme_review_assignments ra where ra.id=p_assignment and quizbox_market.question_allowed(ra.question_id)');
  end if;
 end loop;
end $$;
commit;
