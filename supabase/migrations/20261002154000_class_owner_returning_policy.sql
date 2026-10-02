begin;
-- Same owner authorization, evaluated against the new row for INSERT RETURNING.
alter policy classes_select on public.classes using (
 public.qb_is_platform_admin() or primary_teacher_id=public.qb_current_teacher_id()
 or public.qb_can_manage_class(id) or public.qb_is_class_member(id)
);
alter policy classes_update on public.classes with check (
 public.qb_is_platform_admin() or primary_teacher_id=public.qb_current_teacher_id()
 or (tenant_id is not null and public.qb_can_manage_tenant(tenant_id))
);
notify pgrst,'reload schema';
commit;
