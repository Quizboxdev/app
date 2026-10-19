-- Rollback for 20261019100000_client_error_monitoring (stored CLIENT_ERROR events stay in system_events).
drop function if exists public.qb_admin_client_errors(integer);
drop function if exists public.qb_record_client_error(text, text, text, text);
