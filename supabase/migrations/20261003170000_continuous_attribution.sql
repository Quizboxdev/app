-- Attribution was only performed by migrations, so content created later (e.g. a newly launched market)
-- could never be served. Apply the same deterministic node rule continuously; anything else is queued.
begin;
create or replace function quizbox_market.attribute_legacy_by_node() returns integer language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 insert into public.legacy_content_attributions(question_id,curriculum_id,market_id,reason)
 select q.id,n.curriculum_id,mc.market_id,'Question node belongs to a market-mapped curriculum with a recorded authority'
 from public.questions q
 join public.curriculum_nodes n on n.id=q.curriculum_node_id and n.is_active
 join public.market_curricula mc on mc.curriculum_id=n.curriculum_id and mc.active and mc.authority_id is not null
 join public.curriculum_authorities a on a.id=mc.authority_id and a.market_id=mc.market_id and a.active
 where (q.curriculum_id is null or q.curriculum_id=n.curriculum_id) and q.origin_candidate_id is null and cardinality(q.source_document_ids)=0
 on conflict (question_id) do nothing;
 get diagnostics added=row_count;
 delete from public.market_attribution_issues i using public.legacy_content_attributions l where i.entity='question' and i.record_id=l.question_id;
 insert into public.market_attribution_issues(entity,record_id,reason)
 select 'question',q.id,case
   when q.curriculum_node_id is null then 'No curriculum or node provenance; manual review required'
   when not exists(select 1 from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active) then 'Node missing or inactive; manual review required'
   when exists(select 1 from public.curriculum_nodes n where n.id=q.curriculum_node_id and q.curriculum_id is not null and q.curriculum_id<>n.curriculum_id) then 'Question and node curricula disagree; manual review required'
   else 'Node curriculum has no active market/authority mapping; manual review required' end
 from public.questions q
 where q.origin_candidate_id is null and not exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id)
 on conflict (entity,record_id) do update set reason=excluded.reason;
 return added;
end $$;

create function quizbox_market.attribute_question() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.origin_candidate_id is null and new.curriculum_node_id is not null and cardinality(new.source_document_ids)=0 then
  insert into public.legacy_content_attributions(question_id,curriculum_id,market_id,reason)
  select new.id,n.curriculum_id,mc.market_id,'Question node belongs to a market-mapped curriculum with a recorded authority'
  from public.curriculum_nodes n
  join public.market_curricula mc on mc.curriculum_id=n.curriculum_id and mc.active and mc.authority_id is not null
  join public.curriculum_authorities a on a.id=mc.authority_id and a.market_id=mc.market_id and a.active
  where n.id=new.curriculum_node_id and n.is_active and (new.curriculum_id is null or new.curriculum_id=n.curriculum_id)
  on conflict (question_id) do nothing;
  if found then delete from public.market_attribution_issues where entity='question' and record_id=new.id; end if;
 end if;
 return null;
end $$;
create trigger question_market_attribution after insert or update of curriculum_node_id,curriculum_id on public.questions for each row execute function quizbox_market.attribute_question();
revoke all on function quizbox_market.attribute_question() from public,anon,authenticated;
revoke all on function quizbox_market.attribute_legacy_by_node() from public,anon,authenticated;
select quizbox_market.attribute_legacy_by_node();
commit;
