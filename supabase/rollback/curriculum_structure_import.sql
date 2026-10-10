-- Rolls back 20261012110000_curriculum_structure_import.sql (function only).
-- Nodes already imported are data: remove them deliberately by curriculum if that is ever wanted; nothing here deletes data.
begin;
drop function if exists public.qb_curriculum_nodes_import(uuid, jsonb, text, text);
commit;
