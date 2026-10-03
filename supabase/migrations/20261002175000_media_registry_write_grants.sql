-- Existing admin-only RLS policies remain the authorization boundary.
grant select,insert,update on public.media_assets to authenticated;
revoke insert,update,delete on public.media_assets from anon;
