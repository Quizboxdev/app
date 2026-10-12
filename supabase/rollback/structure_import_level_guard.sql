-- Rolls back 20261012170000_structure_import_level_guard.sql: restores the function body from 20261012110000 (no level checks).
-- No data is touched.
begin;

create or replace function public.qb_curriculum_nodes_import(p_curriculum uuid, p_nodes jsonb, p_source_file text default null, p_source_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n jsonb; pid uuid; added integer := 0; existing integer := 0; changed integer; kinds constant text[] :=
    array['education_level', 'grade', 'subject', 'strand', 'sub_strand', 'content_standard', 'learning_indicator'];
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.curricula where id = p_curriculum) then raise exception 'CURRICULUM_NOT_FOUND'; end if;
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) not between 1 and 1000 then raise exception 'QB_INVALID_BATCH'; end if;

  for n in select value from jsonb_array_elements(p_nodes) loop
    if (n ->> 'node_type') is null or not ((n ->> 'node_type') = any (kinds)) then raise exception 'QB_NODE_INVALID_TYPE'; end if;
    if length(btrim(coalesce(n ->> 'code', ''))) = 0 or length(btrim(coalesce(n ->> 'title', ''))) = 0 or length(btrim(coalesce(n ->> 'identity_key', ''))) = 0 then
      raise exception 'QB_NODE_INVALID'; end if;
    pid := null;
    if nullif(n ->> 'parent_key', '') is not null then
      select id into pid from public.curriculum_nodes where curriculum_id = p_curriculum and identity_key = n ->> 'parent_key';
      if pid is null then raise exception 'QB_NODE_PARENT_MISSING:%', n ->> 'parent_key'; end if;
    end if;
    insert into public.curriculum_nodes(curriculum_id, parent_id, node_type, code, identity_key, title, source_terminology, education_level, grade_code,
      source_grade_code, canonical_grade_code, subject_code, sort_order, source_file, source_version, metadata, is_active)
    values (p_curriculum, pid, n ->> 'node_type', btrim(n ->> 'code'), n ->> 'identity_key', btrim(n ->> 'title'), coalesce(nullif(n ->> 'source_terminology', ''), n ->> 'node_type'),
      nullif(n ->> 'education_level', ''), nullif(n ->> 'grade_code', ''), nullif(n ->> 'source_grade_code', ''), nullif(n ->> 'canonical_grade_code', ''),
      nullif(n ->> 'subject_code', ''), coalesce((n ->> 'sort_order')::integer, 0), left(p_source_file, 300), left(p_source_version, 100),
      coalesce(case when jsonb_typeof(n -> 'metadata') = 'object' then n -> 'metadata' end, '{}'::jsonb), true)
    on conflict (curriculum_id, identity_key) do nothing;
    get diagnostics changed = row_count;
    if changed = 1 then added := added + 1; else existing := existing + 1; end if;
  end loop;
  return jsonb_build_object('inserted', added, 'existing', existing);
end $$;

revoke all on function public.qb_curriculum_nodes_import(uuid, jsonb, text, text) from public, anon;
grant execute on function public.qb_curriculum_nodes_import(uuid, jsonb, text, text) to authenticated;

commit;
