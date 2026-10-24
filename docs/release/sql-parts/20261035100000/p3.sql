revoke all on function public.qb_admin_payment_facts(text), public.qb_admin_refund_credit(text, integer, text, uuid, boolean), public.qb_admin_refund_case_save(text, text, text, text, uuid, boolean), public.qb_admin_refund_cases(integer) from public, anon, authenticated;
grant execute on function public.qb_admin_payment_facts(text), public.qb_admin_refund_credit(text, integer, text, uuid, boolean), public.qb_admin_refund_case_save(text, text, text, text, uuid, boolean), public.qb_admin_refund_cases(integer) to authenticated;


notify pgrst, 'reload schema';
