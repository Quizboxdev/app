-- Rollback for 20261120110000_reassert_browser_role_grants.sql. Puts back Preview's old open grant on public.profiles (a signed-in user could then change their own role).
-- TRUNCATE, REFERENCES and TRIGGER are NOT given back to the browser roles: no screen needs them, and restoring them would only reopen the gap.
-- Never run this on Production.
begin;
grant update on public.profiles to authenticated;
commit;
