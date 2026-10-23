-- Rollback for 20261037100000_policy_seed_v1.sql: removes the version 1 DRAFTS only (a published version is evidence and is never deleted by this script).
begin;
delete from public.policy_versions where version_no = 1 and state = 'draft' and summary = 'Initial version' and created_by is null;
commit;
