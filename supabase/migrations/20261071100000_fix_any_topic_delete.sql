-- Fix: choosing "Any topic" in Assign by subject and topic failed with "DELETE requires a WHERE clause" (the database refuses a delete with no WHERE).
-- The only change from 20261055100000 is in quizbox_topic.blueprint_plan: `delete from qb_bp_alloc;` becomes `delete from qb_bp_alloc where true;`. Same behaviour, one line. Grants are unchanged by create or replace.
-- Additive and idempotent. Rollback: re-run the quizbox_topic.blueprint_plan definition from 20261055100000 (supabase/rollback/fix_any_topic_delete.md).
begin;

create or replace function quizbox_topic.blueprint_plan(p_class uuid, p_sections jsonb, p_difficulty text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c public.classes; acc boolean; n_sections integer; total integer := 0; sec jsonb; pos integer := 0; subj text; quota integer; sec_diff text; explicit boolean;
  tids uuid[]; k integer; base integer; rem integer; t record; v_share integer; spare integer; allocated integer; tp integer; avail_all integer;
  picked jsonb; all_ids uuid[] := '{}'; sections_out jsonb := '[]'; shares jsonb := '[]'; nodes uuid[] := '{}'; grades text[] := '{}'; topic_out jsonb;
  seen text[] := '{}'; target_grade text;
begin
  c := quizbox_topic.class_for_teacher(p_class);
  acc := c.class_name = 'QuizBox Developer Acceptance Class';
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then raise exception 'QB_BLUEPRINT_INVALID'; end if;
  n_sections := jsonb_array_length(p_sections);
  if n_sections < 1 or n_sections > 8 then raise exception 'QB_BLUEPRINT_SECTIONS_INVALID'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'QB_TOPIC_DIFFICULTY_INVALID'; end if;
  for sec in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(sec) <> 'object' or btrim(coalesce(sec ->> 'subject', '')) = '' or coalesce(sec ->> 'quota', '') !~ '^[0-9]{1,3}$' then raise exception 'QB_BLUEPRINT_INVALID'; end if;
    if (sec ->> 'quota')::integer < 1 then raise exception 'QB_BLUEPRINT_INVALID'; end if;
    if btrim(sec ->> 'subject') = any (seen) then raise exception 'QB_BLUEPRINT_DUPLICATE_SUBJECT'; end if;
    seen := seen || btrim(sec ->> 'subject');
    total := total + (sec ->> 'quota')::integer;
  end loop;
  if total < 1 or total > 100 then raise exception 'QB_TOPIC_TOTAL_INVALID'; end if;
  -- Several subjects in one quiz: Primary and JHS classes only.
  if n_sections > 1 and quizbox_topic.class_level(coalesce(nullif(c.grade_code, ''), c.grade::text), c.education_level) not in ('PRIMARY', 'JHS') then
    raise exception 'QB_COMBINED_LEVEL_NOT_ALLOWED';
  end if;

  -- The grade of the quiz: that of the first topic a section names, otherwise the class's own grade (B10 is the legacy code for SHS1). "Any topic" sections stay inside it.
  select coalesce(n.canonical_grade_code, n.grade_code) into target_grade from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
   where x.id::text = (select s ->> 0 from (select sx -> 'topic_ids' as s from jsonb_array_elements(p_sections) sx where jsonb_typeof(sx -> 'topic_ids') = 'array' and jsonb_array_length(sx -> 'topic_ids') > 0 limit 1) f);
  if target_grade is null then
    target_grade := upper(coalesce(nullif(c.grade_code, ''), c.grade::text));
    if target_grade = 'B10' then target_grade := 'SHS1'; end if;
  end if;

  for sec in select value from jsonb_array_elements(p_sections) loop
    pos := pos + 1;
    subj := btrim(sec ->> 'subject'); quota := (sec ->> 'quota')::integer;
    sec_diff := coalesce(nullif(sec ->> 'difficulty', ''), p_difficulty);
    if sec_diff is not null and sec_diff not in ('easy', 'medium', 'hard') then raise exception 'QB_TOPIC_DIFFICULTY_INVALID'; end if;
    explicit := jsonb_typeof(sec -> 'topic_ids') = 'array' and jsonb_array_length(sec -> 'topic_ids') > 0;
    if explicit then
      select array_agg(distinct x::uuid) into tids from jsonb_array_elements_text(sec -> 'topic_ids') x;
      k := coalesce(cardinality(tids), 0);
      if k < 1 or k > 20 then raise exception 'QB_TOPIC_COUNT_INVALID'; end if;
      if (select count(*) from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
           where x.id = any (tids) and x.status = 'ACTIVE' and x.curriculum_id = c.curriculum_id and n.subject_code = subj) <> k then
        raise exception 'QB_TOPIC_UNAVAILABLE';
      end if;
      if quota < k then raise exception 'QB_BLUEPRINT_QUOTA_TOO_SMALL: % needs at least % questions for % topics', subj, k, k; end if;
    else
      select coalesce(array_agg(z.id), '{}') into tids from (
        select x.id from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
         where x.status = 'ACTIVE' and x.curriculum_id = c.curriculum_id and n.subject_code = subj and coalesce(n.canonical_grade_code, n.grade_code) = target_grade
           and exists (select 1 from quizbox_topic.listable_questions(x.id, c.tenant_id, acc))
         order by random() limit least(quota, 10)) z;
      k := coalesce(cardinality(tids), 0);
      if k < 1 then raise exception 'QB_TOPIC_UNAVAILABLE'; end if;
    end if;

    -- How the quota is spread over this section's topics.
    topic_out := '[]'; allocated := 0;
    if explicit then
      base := quota / k; rem := quota % k; tp := 0;
      for t in select tp2.id, tp2.title, tp2.indicator_node_id, (select count(*) from quizbox_topic.listable_questions(tp2.id, c.tenant_id, acc))::integer as available,
                      (select coalesce(n.canonical_grade_code, n.grade_code) from public.curriculum_nodes n where n.id = tp2.indicator_node_id) as grade
                 from public.curriculum_topics tp2 where tp2.id = any (tids) order by available desc, tp2.title, tp2.id loop
        tp := tp + 1;
        v_share := base + case when tp <= rem then 1 else 0 end;
        picked := quizbox_topic.pick_for_topic(t.id, t.title, v_share, sec_diff, c.tenant_id, acc, all_ids);
        all_ids := all_ids || array(select jsonb_array_elements_text(picked -> 'picked'))::uuid[];
        if not t.indicator_node_id = any (nodes) then nodes := nodes || t.indicator_node_id; end if;
        if t.grade is not null and not t.grade = any (grades) then grades := grades || t.grade; end if;
        topic_out := topic_out || jsonb_build_object('topic_id', t.id, 'title', t.title, 'share', v_share, 'available', t.available, 'easy', picked -> 'easy', 'medium', picked -> 'medium', 'hard', picked -> 'hard');
        shares := shares || jsonb_build_object('topic_id', t.id, 'share', v_share);
      end loop;
    else
      -- "Any topic": spread one question at a time over the chosen topics, never past what a topic holds, so a thin topic hands the rest to the others.
      select coalesce(sum(a), 0) into avail_all from (select (select count(*) from quizbox_topic.listable_questions(x, c.tenant_id, acc))::integer as a from unnest(tids) x) y;
      if avail_all < quota then raise exception 'QB_TOPIC_SHORT: % has % available, % needed', subj, avail_all, quota; end if;
      create temporary table if not exists qb_bp_alloc(topic_id uuid primary key, title text, indicator_node_id uuid, grade text, available integer, share integer) on commit drop;
      delete from qb_bp_alloc where true;
      insert into qb_bp_alloc select tp2.id, tp2.title, tp2.indicator_node_id, (select coalesce(n.canonical_grade_code, n.grade_code) from public.curriculum_nodes n where n.id = tp2.indicator_node_id),
             (select count(*) from quizbox_topic.listable_questions(tp2.id, c.tenant_id, acc))::integer, 0 from public.curriculum_topics tp2 where tp2.id = any (tids);
      spare := quota;
      while spare > 0 loop
        update qb_bp_alloc set share = share + 1 where topic_id in (select topic_id from qb_bp_alloc where share < available order by share, available desc, topic_id limit spare);
        get diagnostics allocated = row_count;
        exit when allocated = 0;
        spare := spare - allocated;
      end loop;
      for t in select * from qb_bp_alloc where share > 0 order by available desc, title, topic_id loop
        picked := quizbox_topic.pick_for_topic(t.topic_id, t.title, t.share, sec_diff, c.tenant_id, acc, all_ids);
        all_ids := all_ids || array(select jsonb_array_elements_text(picked -> 'picked'))::uuid[];
        if not t.indicator_node_id = any (nodes) then nodes := nodes || t.indicator_node_id; end if;
        if t.grade is not null and not t.grade = any (grades) then grades := grades || t.grade; end if;
        topic_out := topic_out || jsonb_build_object('topic_id', t.topic_id, 'title', t.title, 'share', t.share, 'available', t.available, 'easy', picked -> 'easy', 'medium', picked -> 'medium', 'hard', picked -> 'hard');
        shares := shares || jsonb_build_object('topic_id', t.topic_id, 'share', t.share);
      end loop;
    end if;
    sections_out := sections_out || jsonb_build_object('position', pos, 'subject', subj, 'quota', quota, 'topics', topic_out);
  end loop;

  if cardinality(grades) > 1 then raise exception 'QB_BLUEPRINT_ONE_GRADE'; end if;
  return jsonb_build_object('total', total, 'sections', sections_out, 'shares', shares, 'question_ids', to_jsonb(all_ids), 'node_ids', to_jsonb(nodes));
end $fn$;


commit;
