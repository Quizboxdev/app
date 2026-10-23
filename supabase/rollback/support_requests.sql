-- Rollback for 20261038100000_support_requests.sql. Removes support requests, their messages and file records. Files already stored in the "support-files" bucket are NOT deleted by SQL:
-- remove them in Supabase, Storage, support-files if you want them gone. Export first (select * from public.support_requests) if there are requests you need to keep.
begin;
drop function if exists public.qb_support_file_add(uuid, uuid, text, text, text, integer, text);
drop function if exists public.qb_support_file_authorize(uuid);
drop function if exists public.qb_support_request_authorize(uuid);
drop function if exists public.qb_support_delete(uuid);
drop function if exists public.qb_support_set(uuid, text, text, uuid);
drop function if exists public.qb_support_staff_reply(uuid, text, boolean, text);
drop function if exists public.qb_support_admin_list(text, integer);
drop function if exists public.qb_support_reply(uuid, text);
drop function if exists public.qb_support_request_get(uuid);
drop function if exists public.qb_support_my_requests();
drop function if exists public.qb_support_create_public(text, text, text, text, text, text);
drop function if exists public.qb_support_create(text, text, text, text);
drop function if exists public.qb_support_category_ok(text);
drop function if exists public.qb_support_is_staff();
drop table if exists public.support_request_files;
drop table if exists public.support_request_messages;
drop table if exists public.support_requests;
commit;
notify pgrst, 'reload schema';
