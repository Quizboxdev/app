-- Ghana Upper Primary (B4–B6) curriculum structure.
-- The Ghana Common Core Programme (GH-CCP-2020) covers B7–B10 only, so Primary is NOT added to it. Upper Primary follows NaCCA's
-- Standards-Based Curriculum (SBC, 2019): a separate national curriculum for the Ghana market under the NaCCA authority.
-- This creates its selectable structure (education level -> grades B4-B6 -> subjects) so teachers can create Primary classes and
-- learners can be placed. Strands/indicators and questions come later through the normal curriculum-source import.
-- Data only and idempotent (re-running changes nothing). Touches no existing curriculum, node, class or question.
begin;

do $primary$
declare
  v_market uuid; v_authority uuid; v_curriculum uuid; v_level uuid; v_grade uuid;
  v_level_title constant text := 'Primary';
  g record; s record;
begin
  select m.id into v_market from public.markets m join public.countries c on c.id = m.country_id
   where c.iso2_code = 'GH' and not m.is_test order by (m.status = 'ACTIVE') desc, m.name limit 1;
  if v_market is null then raise exception 'GHANA_MARKET_NOT_FOUND'; end if;
  select id into v_authority from public.curriculum_authorities where market_id = v_market and code = 'NaCCA';

  -- curriculum (national identity: market fixed at creation)
  select id into v_curriculum from public.curricula where code = 'GH-SBC-2019';
  if v_curriculum is null then
    insert into public.curricula(code, name, country, version, status, market_id, source_name)
    values ('GH-SBC-2019', 'Ghana Standards-Based Curriculum (Primary)', 'Ghana', '2019', 'ACTIVE', v_market, 'NaCCA Standards-Based Curriculum B4-B6')
    returning id into v_curriculum;
  end if;
  insert into public.market_curricula(curriculum_id, market_id, authority_id, active)
  values (v_curriculum, v_market, v_authority, true)
  on conflict (curriculum_id) do update set active = true, authority_id = coalesce(public.market_curricula.authority_id, excluded.authority_id);

  -- education level
  insert into public.curriculum_nodes(curriculum_id, parent_id, node_type, code, title, source_terminology, education_level, sort_order, source_file, source_version, metadata, is_active, identity_key)
  values (v_curriculum, null, 'education_level', 'LEVEL:PRIMARY', v_level_title, 'Education Level', v_level_title, 0, 'NaCCA-SBC-B4-B6', '2019', '{"structure_only": true}', true,
          v_level_title || '|GLOBAL|GLOBAL|education_level|LEVEL:PRIMARY')
  on conflict (curriculum_id, identity_key) do nothing;
  select id into v_level from public.curriculum_nodes where curriculum_id = v_curriculum and identity_key = v_level_title || '|GLOBAL|GLOBAL|education_level|LEVEL:PRIMARY';

  for g in select * from (values ('B4', 0), ('B5', 1), ('B6', 2)) v(code, ord) loop
    insert into public.curriculum_nodes(curriculum_id, parent_id, node_type, code, title, source_terminology, education_level, grade_code, sort_order, source_file, source_version, metadata, is_active, identity_key, source_grade_code, canonical_grade_code)
    values (v_curriculum, v_level, 'grade', 'GRADE:' || g.code, g.code, 'Grade / Form', v_level_title, g.code, g.ord, 'NaCCA-SBC-B4-B6', '2019', '{"structure_only": true}', true,
            v_level_title || '|' || g.code || '|GLOBAL|grade|GRADE:' || g.code, g.code, g.code)
    on conflict (curriculum_id, identity_key) do nothing;
    select id into v_grade from public.curriculum_nodes where curriculum_id = v_curriculum and identity_key = v_level_title || '|' || g.code || '|GLOBAL|grade|GRADE:' || g.code;

    -- Upper Primary SBC learning areas; subject codes match the existing curricula / market configuration where they overlap.
    for s in select * from (values
        ('English Language', 'ENGLISH_LANGUAGE', 0), ('Mathematics', 'MATHEMATICS', 1), ('Science', 'SCIENCE', 2),
        ('Our World Our People', 'OUR_WORLD_OUR_PEOPLE', 3), ('Religious and Moral Education', 'RELIGIOUS_AND_MORAL_EDUCATION', 4),
        ('Computing', 'COMPUTING', 5), ('Creative Arts', 'CREATIVE_ARTS', 6), ('Ghanaian Language', 'GHANAIAN_LANGUAGE', 7),
        ('FRENCH', 'FRENCH', 8), ('ARABIC', 'ARABIC', 9)) v(subject, slug, ord) loop
      insert into public.curriculum_nodes(curriculum_id, parent_id, node_type, code, title, source_terminology, education_level, grade_code, subject_code, sort_order, source_file, source_version, metadata, is_active, identity_key, source_grade_code, canonical_grade_code)
      values (v_curriculum, v_grade, 'subject', 'SUBJECT:' || g.code || ':' || s.slug, s.subject, 'Subject', v_level_title, g.code, s.subject, s.ord, 'NaCCA-SBC-B4-B6', '2019', '{"structure_only": true}', true,
              v_level_title || '|' || g.code || '|' || s.subject || '|subject|SUBJECT:' || g.code || ':' || s.slug, g.code, g.code)
      on conflict (curriculum_id, identity_key) do nothing;
    end loop;
  end loop;

  if (select count(*) from public.curriculum_nodes where curriculum_id = v_curriculum and node_type = 'grade' and is_active) <> 3
     or (select count(*) from public.curriculum_nodes where curriculum_id = v_curriculum and node_type = 'subject' and is_active) <> 30 then
    raise exception 'GHANA_PRIMARY_CURRICULUM_INCOMPLETE';
  end if;
end $primary$;

commit;
