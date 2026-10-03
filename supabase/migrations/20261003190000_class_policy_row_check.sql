-- market_class_read looked the class up by id; during INSERT ... RETURNING the new row is not visible to
-- that lookup, so creating any class failed. Evaluate the same rule on the row's own columns.
begin;
create function quizbox_market.class_row_allowed(p_curriculum uuid,p_tenant uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=quizbox_market.resolve_context();
 return quizbox_market.curriculum_allowed(p_curriculum,c)
  or (p_curriculum is null and exists(select 1 from public.tenants t where t.id=p_tenant and c->'market_ids' @> jsonb_build_array(t.market_id)));
exception when sqlstate '42501' then return false;
end $$;
revoke all on function quizbox_market.class_row_allowed(uuid,uuid) from public,anon;
grant execute on function quizbox_market.class_row_allowed(uuid,uuid) to authenticated;
drop policy market_class_read on public.classes;
create policy market_class_read on public.classes as restrictive for select to authenticated using (quizbox_market.class_row_allowed(curriculum_id,tenant_id));
commit;
