-- Teachers who join through country-first onboarding run self-serve classes without a tenant.
-- Their assessments had tenant_id null and failed the tenant clause, hiding them from their own
-- enrolled students. Treat a null tenant as the public tenant; market governance, class membership
-- and assignment targeting checks are unchanged.
begin;
do $$ declare body text; old_expr text:='(a.tenant_id=public.qb_public_tenant_id() or'; begin
 body:=pg_get_functiondef('public.qb_can_access_learning_assessment(uuid)'::regprocedure);
 if position(old_expr in body)=0 then raise exception 'LEARNING_ACCESS_CONTRACT_MISMATCH'; end if;
 execute replace(body,old_expr,'(a.tenant_id is null or a.tenant_id=public.qb_public_tenant_id() or');
end $$;
commit;
