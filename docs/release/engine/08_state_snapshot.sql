-- READ-ONLY. One result: everything the curriculum, source and loading steps may have changed.
-- Run it, copy the whole table, and send it back. Nothing is written.
select area, item, detail, n from (
  select 1 as o, 'curriculum' as area, c.code as item,
    'active_in_market=' || coalesce(mc.active, false)::text || '; all_nodes=' || (select count(*) from public.curriculum_nodes x where x.curriculum_id = c.id)::text as detail,
    (select count(*) from public.curriculum_nodes x where x.curriculum_id = c.id and x.node_type = 'learning_indicator') as n
  from public.curricula c left join public.market_curricula mc on mc.curriculum_id = c.id
  union all
  select 2, 'source registry', c.code, r.education_level || ' / ' || r.status, count(*)
  from quizbox_sources.registry r join public.curricula c on c.id = r.curriculum_id
  group by c.code, r.education_level, r.status
  union all
  select 3, 'source documents', c.code, d.validation_status || ' / rights=' || coalesce(d.rights_confirmed, false)::text || ' / ' || coalesce(d.source_kind, ''), count(*)
  from public.source_documents d join public.curricula c on c.id = d.curriculum_id
  group by c.code, d.validation_status, d.rights_confirmed, d.source_kind
  union all
  select 4, 'authority domains', a.name, coalesce(array_to_string(a.official_domains, ', '), ''), null::bigint
  from public.curriculum_authorities a
  union all
  select 5, 'source packages', p.name, p.package_type, p.entry_count::bigint
  from quizbox_sources.packages p
  union all
  select 6, 'question load batches', 'question_load_batches', b.status, count(*)
  from public.question_load_batches b group by b.status
  union all
  select 7, 'topics', 'curriculum_topics', 'rows', count(*) from public.curriculum_topics
  union all
  select 8, 'pool picks', 'sme_review_assignments', 'picked_from_pool', count(*) from public.sme_review_assignments where picked_from_pool
) s order by o, item, detail;
