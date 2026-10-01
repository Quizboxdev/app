begin;

alter table public.curriculum_nodes add column if not exists identity_key text;

update public.curriculum_nodes
set identity_key = coalesce(nullif(subject_code, ''), 'GLOBAL') || ':' || code
where identity_key is null;

alter table public.curriculum_nodes alter column identity_key set not null;
alter table public.curriculum_nodes drop constraint if exists curriculum_nodes_curriculum_id_node_type_code_key;
alter table public.curriculum_nodes drop constraint if exists curriculum_nodes_curriculum_id_identity_key_key;
alter table public.curriculum_nodes add constraint curriculum_nodes_curriculum_id_identity_key_key unique (curriculum_id, identity_key);

commit;
