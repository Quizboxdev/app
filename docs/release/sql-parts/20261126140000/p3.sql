grant execute on function public.interschool_issue_certificates(uuid), public.interschool_revoke_certificate(text, text), public.interschool_my_certificates(), public.interschool_admin_overview() to authenticated;
grant execute on function public.interschool_verify_certificate(text) to authenticated, service_role;
grant execute on function public.interschool_send_reminders() to service_role;


notify pgrst, 'reload schema';
