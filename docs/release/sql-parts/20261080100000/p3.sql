revoke all on function public.qb_family_child_provision(uuid, uuid, text, text, text, integer, text, text, text, text), public.qb_family_invite_peek(text), public.qb_family_invite_consume(text) from public, anon, authenticated;
revoke all on function public.qb_family_invite_issue(uuid), public.qb_family_invite_revoke(uuid), public.qb_family_link_request(text), public.qb_family_my_requests(), public.qb_family_link_respond(uuid, boolean), public.qb_family_children() from public, anon, authenticated;
grant execute on function public.qb_family_invite_issue(uuid), public.qb_family_invite_revoke(uuid), public.qb_family_link_request(text), public.qb_family_my_requests(), public.qb_family_link_respond(uuid, boolean), public.qb_family_children() to authenticated;


notify pgrst, 'reload schema';
