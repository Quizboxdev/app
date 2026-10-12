-- Curriculum structure import: keep Primary, JHS and SHS content in their own curricula (server-side; the screen cannot be the only check).
-- Why: on 2026-10-12 a JHS structure had been loaded into the Primary curriculum (GH-SBC-2019) and 2,516 nodes had to be removed by hand,
-- because qb_curriculum_nodes_import accepted any node for any curriculum. This replaces that one function and nothing else.
--   * Primary (B4-B6) nodes may only be imported into a curriculum that holds no JHS/SHS content, and may not be mixed with JHS/SHS nodes in one call.
--   * JHS/SHS nodes may not be imported into a curriculum that holds Primary content.
--   * A Primary node must be in grade B4, B5 or B6, and a JHS/SHS node may not carry a Primary grade (a grade/level contradiction).
-- JHS and SHS may still share a legacy curriculum (GH-CCP-2020 holds both), so existing behaviour for those two levels is unchanged.
-- Idempotent, additive, no table or policy changes. Rollback: supabase/rollback/structure_import_level_guard.sql restores 20261012110000's body.
begin;

create or replace function public.qb_curriculum_nodes_import(p_curriculum uuid, p_nodes jsonb, p_source_file text default null, p_source_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n jsonb; pid uuid; added integer := 0; existing integer := 0; changed integer; kinds constant text[] :=
    array['education_level', 'grade', 'subject', 'strand', 'sub_strand', 'content_standard', 'learning_indicator'];
  in_primary boolean; in_other boolean; has_primary boolean; has_other boolean; lvl text; grd text;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.curricula where id = p_curriculum) then raise exception 'CURRICULUM_NOT_FOUND'; end if;
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) not between 1 and 1000 then raise exception 'QB_INVALID_BATCH'; end if;

  select coalesce(bool_or(lower(value ->> 'education_level') = 'primary'), false),
         coalesce(bool_or(coalesce(nullif(value ->> 'education_level', ''), '') <> '' and lower(value ->> 'education_level') <> 'primary'), false)
    into in_primary, in_other from jsonb_array_elements(p_nodes);
  select coalesce(bool_or(lower(c.education_level) = 'primary'), false), coalesce(bool_or(c.education_level is not null and lower(c.education_level) <> 'primary'), false)
    into has_primary, has_other from public.curriculum_nodes c where c.curriculum_id = p_curriculum;
  if in_primary and in_other then raise exception 'QB_STRUCTURE_MIXED_LEVELS'; end if;
  if in_primary and has_other then raise exception 'QB_STRUCTURE_LEVEL_MISMATCH:Primary into a JHS/SHS curriculum'; end if;
  if in_other and has_primary then raise exception 'QB_STRUCTURE_LEVEL_MISMATCH:JHS/SHS into a Primary curriculum'; end if;

  for n in select value from jsonb_array_elements(p_nodes) loop
    if (n ->> 'node_type') is null or not ((n ->> 'node_type') = any (kinds)) then raise exception 'QB_NODE_INVALID_TYPE'; end if;
    if length(btrim(coalesce(n ->> 'code', ''))) = 0 or length(btrim(coalesce(n ->> 'title', ''))) = 0 or length(btrim(coalesce(n ->> 'identity_key', ''))) = 0 then
      raise exception 'QB_NODE_INVALID'; end if;
    lvl := lower(coalesce(n ->> 'education_level', ''));
    grd := upper(coalesce(nullif(n ->> 'canonical_grade_code', ''), nullif(n ->> 'grade_code', ''), ''));
    if lvl = 'primary' and grd <> '' and grd not in ('B4', 'B5', 'B6') then raise exception 'QB_STRUCTURE_GRADE_NOT_IN_LEVEL:%', grd; end if;
    if lvl <> 'primary' and lvl <> '' and grd in ('B4', 'B5', 'B6') then raise exception 'QB_STRUCTURE_GRADE_NOT_IN_LEVEL:%', grd; end if;
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
