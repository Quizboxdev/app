-- READ-ONLY. Every curriculum, whether it is active in its market, and how many approved, rights-confirmed sources it has.
-- Loading questions needs: an active curriculum with at least one approved source, and its structure loaded.
select c.code, c.name, c.version, m.name as market,
  coalesce(mc.active, false) as active_in_market, mc.authority_id is not null as has_authority,
  count(d.id) filter (where d.validation_status = 'approved' and d.rights_confirmed) as approved_sources,
  count(d.id) as all_sources,
  (select count(*) from public.curriculum_nodes n where n.curriculum_id = c.id and n.node_type = 'learning_indicator') as indicators_loaded
from public.curricula c
left join public.markets m on m.id = c.market_id
left join public.market_curricula mc on mc.curriculum_id = c.id
left join public.source_documents d on d.curriculum_id = c.id
group by c.id, c.code, c.name, c.version, m.name, mc.active, mc.authority_id
order by c.code;
