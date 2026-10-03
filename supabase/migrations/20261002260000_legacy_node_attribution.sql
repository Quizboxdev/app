-- Legacy questions whose curriculum_id was never set but whose active curriculum node
-- belongs to a market-mapped curriculum with a recorded curriculum authority.
-- Question rows are not modified (no new versions, no text/answer change); attribution
-- is recorded separately and everything else stays in the explicit review queue.
-- Requires 20261002210000 (attribution tables) and 20261002250000 (preserved predicate).
begin;

-- Internal, idempotent backfill. Not executable by API roles.
create function quizbox_market.attribute_legacy_by_node() returns integer language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 insert into public.legacy_content_attributions(question_id,curriculum_id,market_id,reason)
 select q.id,n.curriculum_id,mc.market_id,'Question curriculum unset; its active node belongs to a market-mapped curriculum with a recorded authority'
 from public.questions q
 join public.curriculum_nodes n on n.id=q.curriculum_node_id and n.is_active
 join public.market_curricula mc on mc.curriculum_id=n.curriculum_id and mc.active and mc.authority_id is not null
 join public.curriculum_authorities a on a.id=mc.authority_id and a.market_id=mc.market_id and a.active
 where q.curriculum_id is null and q.origin_candidate_id is null and cardinality(q.source_document_ids)=0
 on conflict (question_id) do nothing;
 get diagnostics added=row_count;
 delete from public.market_attribution_issues i using public.legacy_content_attributions l where i.entity='question' and i.record_id=l.question_id;
 -- Everything still unattributed is queued explicitly with the reason it needs manual review.
 insert into public.market_attribution_issues(entity,record_id,reason)
 select 'question',q.id,case
   when q.curriculum_node_id is null then 'No curriculum or node provenance; manual review required'
   when not exists(select 1 from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active) then 'Node missing or inactive; manual review required'
   else 'Node curriculum has no active market/authority mapping; manual review required' end
 from public.questions q
 where q.origin_candidate_id is null and not exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id)
 on conflict (entity,record_id) do update set reason=excluded.reason;
 return added;
end $$;
revoke all on function quizbox_market.attribute_legacy_by_node() from public,anon,authenticated;
select quizbox_market.attribute_legacy_by_node();

-- The legacy branch compares the attribution with the question's curriculum, falling back to the
-- node's curriculum only when the question's own curriculum_id is null. All other branches unchanged.
do $$ declare body text; begin
 body:=pg_get_functiondef('quizbox_competition.curriculum_question_allowed(uuid,jsonb)'::regprocedure);
 if position('l.curriculum_id=q.curriculum_id) and quizbox_market.curriculum_allowed(q.curriculum_id,c)' in body)=0 then
  raise exception 'LEGACY_PREDICATE_CONTRACT_MISMATCH';
 end if;
 body:=replace(body,'l.curriculum_id=q.curriculum_id) and quizbox_market.curriculum_allowed(q.curriculum_id,c)',
  'l.curriculum_id=coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active))) and quizbox_market.curriculum_allowed(coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active)),c)');
 execute body;
end $$;

commit;
