grant execute on function public.qb_support_create_public(text, text, text, text, text, text), public.qb_support_file_add(uuid, uuid, text, text, text, integer, text), public.qb_support_is_staff() to service_role;

notify pgrst, 'reload schema';

