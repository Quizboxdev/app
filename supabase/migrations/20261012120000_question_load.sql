-- Question load step (tracker L4/L5): records a question file, registers its topics and concepts, imports its rows through the existing
-- governed import (qb_content_factory_import: approved sources, active curriculum in the market, answer and provenance validation,
-- review state, nothing published), and links every created question to its topic and concept.
-- Wraps; does not replace. Requires 20261012100000_topic_registry.sql.
--   p = { batch_id?, file_name, file_sha256, scope: 'CURRICULUM', market_id, curriculum_id, source_document_ids: [uuid],
--         topics: [{ key, indicator_node_id, title, concepts: [text], target_questions? }],
--         rows:   [{ topic_key, concept, indicator_node_id, question_text, answer_type, option_a..option_d, correct_answer, explanation,
--                    difficulty, cognitive_level, source_reference }] }   (at most 500 rows per call)
-- A file larger than 500 rows is sent in several calls: the first passes expected_rows (the file's total) and returns batch_id, which later
-- calls pass back. The batch stays LOADING until all expected rows have arrived.
begin;

create or replace function public.qb_question_load(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.question_load_batches; t jsonb; r jsonb; v_rows jsonb := coalesce(p -> 'rows', '[]'); v_topics jsonb := coalesce(p -> 'topics', '[]');
  saved jsonb; topic_ids jsonb := '{}'; concept_ids jsonb := '{}'; c record; tid uuid; prepared jsonb := '[]'; idx integer := 0;
  imported jsonb; linked integer; total integer; token text;
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_LOAD_ACCESS_DENIED' using errcode = '42501'; end if;
  if coalesce(p ->> 'scope', 'CURRICULUM') <> 'CURRICULUM' then raise exception 'QB_LOAD_SCOPE_UNSUPPORTED'; end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) not between 1 and 500 then raise exception 'QB_LOAD_INVALID_BATCH'; end if;
  if jsonb_typeof(v_topics) <> 'array' or jsonb_array_length(v_topics) not between 1 and 100 then raise exception 'QB_LOAD_INVALID_TOPICS'; end if;

  if nullif(p ->> 'batch_id', '') is null then
    if length(coalesce(p ->> 'file_sha256', '')) <> 64 then raise exception 'QB_LOAD_FILE_HASH_REQUIRED'; end if;
    begin
      insert into public.question_load_batches(file_name, file_sha256, scope, status, uploaded_by, report)
      values (left(coalesce(p ->> 'file_name', 'file'), 300), p ->> 'file_sha256', 'CURRICULUM', 'LOADING', auth.uid(),
              jsonb_build_object('expected_rows', greatest(coalesce((p ->> 'expected_rows')::integer, 0), jsonb_array_length(v_rows)))) returning * into b;
    exception when unique_violation then raise exception 'QB_LOAD_FILE_ALREADY_LOADED';
    end;
  else
    select * into b from public.question_load_batches where id = (p ->> 'batch_id')::uuid for update;
    if b.id is null or b.uploaded_by <> auth.uid() then raise exception 'QB_LOAD_BATCH_NOT_FOUND'; end if;
    if b.status <> 'LOADING' then raise exception 'QB_LOAD_BATCH_CLOSED'; end if;
  end if;

  -- Topics and concepts: created or refreshed by the registry function, then looked up by their keys.
  for t in select value from jsonb_array_elements(v_topics) loop
    saved := public.qb_topic_save(jsonb_build_object('indicator_node_id', t ->> 'indicator_node_id', 'title', t ->> 'title',
      'concepts', coalesce(t -> 'concepts', '[]'), 'target_questions', coalesce(t -> 'target_questions', to_jsonb(50))));
    tid := (saved ->> 'topic_id')::uuid;
    topic_ids := topic_ids || jsonb_build_object(t ->> 'key', tid);
    for c in select id, title_key from public.topic_concepts where topic_id = tid loop
      concept_ids := concept_ids || jsonb_build_object((t ->> 'key') || '|' || c.title_key, c.id);
    end loop;
  end loop;

  -- Each row carries a token in its source reference (first, so it survives the 120-character tag limit); it is how created questions are found.
  for r in select value from jsonb_array_elements(v_rows) loop
    idx := idx + 1;
    if not (topic_ids ? (r ->> 'topic_key')) then raise exception 'QB_LOAD_UNKNOWN_TOPIC:%', r ->> 'topic_key'; end if;
    token := 'QL:' || b.id || ':' || (b.rows_total + idx);
    prepared := prepared || jsonb_build_object('curriculum_node_id', r ->> 'indicator_node_id', 'subject', r ->> 'subject', 'grade', r ->> 'grade',
      'question_text', r ->> 'question_text', 'answer_type', coalesce(r ->> 'answer_type', 'SINGLE_CHOICE'), 'option_a', r ->> 'option_a', 'option_b', r ->> 'option_b',
      'option_c', r ->> 'option_c', 'option_d', r ->> 'option_d', 'correct_answer', r ->> 'correct_answer', 'explanation', r ->> 'explanation',
      'difficulty', r ->> 'difficulty', 'cognitive_level', r ->> 'cognitive_level',
      'source_reference', token || ' ' || left(coalesce(r ->> 'source_reference', 'n/a'), 200));
  end loop;

  imported := public.qb_content_factory_import(jsonb_build_object('market_id', p ->> 'market_id', 'curriculum_id', p ->> 'curriculum_id',
    'source_document_ids', p -> 'source_document_ids', 'file_name', b.file_name, 'origin', 'IMPORTED', 'rows', prepared));

  -- Link the questions that were created. The row's position in the whole file is the last part of the token.
  with created as (
    select q.id as question_id, (regexp_match(tag, '^source:QL:[0-9a-f-]{36}:([0-9]+)'))[1]::integer as pos
      from public.questions q cross join lateral unnest(q.tags) as tag
     where tag like 'source:QL:' || b.id || ':%'
  ), mapped as (
    select cr.question_id, (v_rows -> (cr.pos - b.rows_total - 1)) as row
      from created cr where cr.pos > b.rows_total and cr.pos <= b.rows_total + jsonb_array_length(v_rows)
  )
  insert into public.question_topic_links(question_id, topic_id, concept_id, created_by)
  select m.question_id, (topic_ids ->> (m.row ->> 'topic_key'))::uuid,
         nullif(concept_ids ->> ((m.row ->> 'topic_key') || '|' || public.qb_topic_normalise(m.row ->> 'concept')), '')::uuid, auth.uid()
    from mapped m
  on conflict (question_id) do nothing;
  get diagnostics linked = row_count;

  total := b.rows_total + jsonb_array_length(v_rows);
  update public.question_load_batches set rows_total = total, rows_loaded = rows_loaded + linked,
         rows_rejected = (total - (rows_loaded + linked)),
         status = case when total < coalesce((report ->> 'expected_rows')::integer, total) then 'LOADING'
                       when (rows_loaded + linked) = 0 then 'FAILED' when (rows_loaded + linked) < total then 'PARTIAL' else 'LOADED' end,
         report = jsonb_set(report, '{chunks}', coalesce(report -> 'chunks', '[]'::jsonb) || jsonb_build_array(imported)), completed_at = now()
   where id = b.id returning * into b;

  return jsonb_build_object('batch_id', b.id, 'status', b.status, 'rows_total', b.rows_total, 'rows_loaded', b.rows_loaded, 'rows_rejected', b.rows_rejected,
    'linked', linked, 'import', imported);
end $$;

revoke all on function public.qb_question_load(jsonb) from public, anon;
grant execute on function public.qb_question_load(jsonb) to authenticated;

commit;
