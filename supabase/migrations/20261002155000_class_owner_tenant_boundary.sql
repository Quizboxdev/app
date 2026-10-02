begin;
alter policy classes_insert on public.classes with check (
 public.qb_is_platform_admin()
 or (primary_teacher_id=public.qb_current_teacher_id() and (tenant_id is null or tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(tenant_id)))
 or (tenant_id is not null and public.qb_can_manage_tenant(tenant_id))
);
alter policy classes_update on public.classes with check (
 public.qb_is_platform_admin()
 or (primary_teacher_id=public.qb_current_teacher_id() and (tenant_id is null or tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(tenant_id)))
 or (tenant_id is not null and public.qb_can_manage_tenant(tenant_id))
);
notify pgrst,'reload schema';
commit;
