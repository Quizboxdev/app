-- Review operations for sponsor competitions. Wraps the delivery dispatcher (same pattern as
-- 20261002240000/250000); every existing action is delegated unchanged except:
--  * assign_candidate now requires content_admin (sponsor members could previously choose reviewers);
--  * assignment_queue / eligible_reviewers: content-admin read models for the admin assignment UI;
--  * review_detail additionally returns the cited source excerpt (after the existing authorization);
--  * leaderboard returns participant display labels instead of other participants' profile ids.
begin;

alter function quizbox_competition.dispatch(text,uuid,jsonb) rename to dispatch_delivery;
revoke all on function quizbox_competition.dispatch_delivery(text,uuid,jsonb) from public,anon,authenticated;

-- First name plus last initial; never an internal identifier.
create function quizbox_competition.participant_label(p_participant uuid,p_rank integer) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select case when cardinality(parts)=1 then parts[1] else parts[1]||' '||upper(left(parts[cardinality(parts)],1))||'.' end
  from (select regexp_split_to_array(btrim(p.full_name),'\s+') parts from public.profiles p where p.id=p_participant and nullif(btrim(p.full_name),'') is not null) n),
  'Participant '||p_rank);
$$;

create function quizbox_competition.dispatch(p_action text,p_sponsor uuid,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare x quizbox_competition.candidates; result jsonb; senior boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action in ('assign_candidate','assignment_queue','eligible_reviewers') and not quizbox_sme.has_capability('content_admin') then
  raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501';
 end if;

 if p_action='assignment_queue' then
  return coalesce((select jsonb_agg(z.row order by z.created_at) from (
   select k.created_at,jsonb_build_object('candidate_id',k.id,'competition_id',k.competition_id,'sponsor_id',d.sponsor_id,
    'sponsor_name',sp.organization_name,'competition_title',d.configuration->>'title','market_id',src.market_id,'market_name',m.name,
    'subject',k.payload->>'subject','difficulty',k.payload->>'difficulty','stem',k.payload->>'stem','status',k.status,
    'primary_assigned',k.primary_assignment_id is not null,'senior_assigned',k.senior_assignment_id is not null,
    'senior_required',quizbox_competition.senior_required(k.competition_id),
    'primary_approved',exists(select 1 from public.sme_review_events e where e.assignment_id=k.primary_assignment_id and e.decision='approve'),
    'primary_reviewer',(select quizbox_competition.participant_label(w.reviewer_id,0) from public.sme_review_assignments w where w.id=k.primary_assignment_id),
    'senior_reviewer',(select quizbox_competition.participant_label(w.reviewer_id,0) from public.sme_review_assignments w where w.id=k.senior_assignment_id)) row
   from quizbox_competition.candidates k join quizbox_competition.drafts d on d.competition_id=k.competition_id
   join public.source_documents src on src.id=k.source_document_id left join public.markets m on m.id=src.market_id
   left join public.sponsor_profiles sp on sp.id=d.sponsor_id
   where k.question_id is null and k.status in ('GENERATED','ASSIGNED_FOR_REVIEW','UNDER_REVIEW','REVISION_REQUIRED','APPROVED')
    and (src.market_id is null or quizbox_market.market_allowed(src.market_id))
    and (nullif(p_data->>'market_id','') is null or src.market_id=(p_data->>'market_id')::uuid)
    and (nullif(p_data->>'subject','') is null or k.payload->>'subject'=p_data->>'subject')
    and (nullif(p_data->>'status','') is null or k.status=p_data->>'status')
   order by k.created_at limit 200) z),'[]');
 end if;

 if p_action='eligible_reviewers' then
  select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid;
  if x.id is null then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  senior:=coalesce(p_data->>'kind','primary')='senior';
  return coalesce((select jsonb_agg(jsonb_build_object('reviewer_id',dom.reviewer_id,'domain_id',dom.id,
    'reviewer_name',coalesce(nullif(btrim(p.full_name),''),'Reviewer'),'subject',dom.subject_code,'tier',sp.reviewer_tier,
    'can_approve',dom.can_approve,'open_reviews',(select count(*) from public.sme_review_assignments w where w.reviewer_id=dom.reviewer_id and w.review_completed_at is null))
    order by p.full_name)
   from public.sme_domain_assignments dom join public.sme_profiles sp on sp.user_id=dom.reviewer_id join public.profiles p on p.id=dom.reviewer_id
   where quizbox_competition.candidate_domain(dom.id,x.id,dom.reviewer_id,senior,false)
    and (not senior or not exists(select 1 from public.sme_review_assignments w where w.id=x.primary_assignment_id and w.reviewer_id=dom.reviewer_id))),'[]');
 end if;

 if p_action='review_detail' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  -- Only the authorized reviewer reaches this point; add the cited excerpt from the candidate's own chunk.
  return result||coalesce((select jsonb_build_object('source',jsonb_build_object('document_title',sd.title,'excerpt',ch.source_text,
    'page',ch.page,'chapter',ch.chapter,'section',ch.section,'heading',ch.heading,'document_id',sd.id,'chunk_id',ch.id))
   from quizbox_competition.candidates c join quizbox_competition.chunks ch on ch.id=c.source_chunk_id and ch.document_id=c.source_document_id
   join public.source_documents sd on sd.id=c.source_document_id where c.id=(result->>'candidate_id')::uuid),'{}');
 end if;

 if p_action='leaderboard' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  return coalesce((select jsonb_agg((e-'participant_id')||jsonb_build_object('display_name',quizbox_competition.participant_label((e->>'participant_id')::uuid,(e->>'rank')::integer),
    'is_you',(e->>'participant_id')::uuid=auth.uid())) from jsonb_array_elements(result) e),'[]');
 end if;

 if p_action='analytics' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  return jsonb_set(result,'{ranking_summary}',coalesce((select jsonb_agg(jsonb_build_object('rank',(e->>'rank')::integer,
    'display_name',quizbox_competition.participant_label((e->>'participant_id')::uuid,(e->>'rank')::integer),
    'score',r.score,'possible_score',r.possible_score,'duration_seconds',r.duration_seconds) order by (e->>'rank')::integer)
   from jsonb_array_elements(result->'ranking_summary') e left join quizbox_competition.official_results r on r.id=(e->>'result_id')::uuid),'[]'));
 end if;

 return quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
end $$;

revoke all on function quizbox_competition.participant_label(uuid,integer) from public,anon,authenticated;
revoke all on function quizbox_competition.dispatch(text,uuid,jsonb) from public,anon;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
commit;
