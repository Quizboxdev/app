grant execute on function public.qb_admin_partner_identity_save(uuid, text, text, text, text, text[], boolean, text), public.qb_admin_partner_slug_set(uuid, text), public.qb_admin_partner_oidc_endpoints_save(uuid, text, text, text), public.qb_admin_partner_detail(uuid),
  public.qb_admin_partner_seats(uuid) to authenticated;


notify pgrst, 'reload schema';
