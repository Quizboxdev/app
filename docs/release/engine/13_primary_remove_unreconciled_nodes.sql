-- GH-SBC-2019 holds 59 extra structure nodes that came from loading the UNRECONCILED file (Primary_indicators_verified.csv) after the
-- reconciled file (Primary_indicators_reconciled.csv) had been loaded. The nodes are: 53 content standards, 1 strand, 1 sub-strand and 4
-- indicators (B6.5.2.2, B4.1.4.1.1, B4.5.3.1.2, B4.5.4.4.6: the printed typos of B6.4.1.2.2, B4.2.4.1.1, B5.5.3.1.2, B4.4.4.4.6).
-- Symptom: the curriculum shows 2,025 nodes and 1,016 indicators instead of 1,966 and 1,012.
-- Step 1 (read only): run the first select. Expect content_standard 53, learning_indicator 4, strand 1, sub_strand 1.
-- Step 2: run the DO block. It refuses to delete unless exactly 59 nodes match and none is used by a question or a topic;
-- every other table points at nodes with ON DELETE RESTRICT, so an in-use node can never be removed by accident.
select n.node_type, count(*) as nodes
from public.curriculum_nodes n join public.curricula c on c.id = n.curriculum_id
where c.code = 'GH-SBC-2019' and n.source_file = 'Primary_indicators_verified.csv'
group by n.node_type order by n.node_type;

do $cleanup$
declare v_cur uuid; v_ids uuid[]; v_n integer;
begin
  select id into v_cur from public.curricula where code = 'GH-SBC-2019';
  if v_cur is null then raise exception 'CURRICULUM_NOT_FOUND'; end if;
  select array_agg(id) into v_ids from public.curriculum_nodes where curriculum_id = v_cur and source_file = 'Primary_indicators_verified.csv';
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n = 0 then raise notice 'Nothing to remove.'; return; end if;
  if v_n <> 59 then raise exception 'EXPECTED_59_NODES_FOUND_%', v_n; end if;
  if exists (select 1 from public.questions where curriculum_node_id = any (v_ids))
     or exists (select 1 from public.curriculum_topics where indicator_node_id = any (v_ids)) then
    raise exception 'NODES_IN_USE';
  end if;
  -- parents and children are removed in one statement (a node's parent is another of these nodes or already referenced only by them)
  delete from public.curriculum_nodes where id = any (v_ids);
  raise notice 'Removed % nodes.', v_n;
end $cleanup$;

-- Check: expect 1966 nodes and 1012 learning indicators (more if the English and Ghanaian Language structure has been loaded).
select count(*) as nodes, count(*) filter (where node_type = 'learning_indicator') as indicators
from public.curriculum_nodes n join public.curricula c on c.id = n.curriculum_id where c.code = 'GH-SBC-2019';
