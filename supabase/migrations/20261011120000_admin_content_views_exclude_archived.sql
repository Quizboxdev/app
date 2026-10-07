-- Admin content views ignore retired (archived) questions, and Coverage counts follow the selected curriculum.
-- After the 2026-10-07 retirement of all development-era questions (status archived), Content Quality still counted them
-- (75 approved, 9 awaiting review, open quality reports on DEV fixtures). Content Operations' coverage summary was computed
-- over every curriculum (the Primary curriculum showed Common Core's 1,357 indicators) and still counted archived fixtures.
-- Read-model change only: no table, row, policy or permission changes. Archived questions stay intact for history.
begin;

create or replace function public.qb_content_quality(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare sup boolean:=quizbox_market.is_super(); rep public.content_reports;
begin
 if not (sup or quizbox_sme.has_capability('content_admin')) then raise exception 'QB_CONTENT_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='summary' then
  return jsonb_build_object(
   'generated',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status in ('generated','draft') and (sup or quizbox_market.question_allowed(q.id))),
   'awaiting_review',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status='review' and (sup or quizbox_market.question_allowed(q.id))),
   'revision_required',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status='needs_revision' and (sup or quizbox_market.question_allowed(q.id))),
   'approved',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status='approved' and q.status::text<>'active' and (sup or quizbox_market.question_allowed(q.id))),
   'published',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status='approved' and q.status::text='active' and (sup or quizbox_market.question_allowed(q.id))),
   'rejected',(select count(*) from public.questions q where q.status::text<>'archived' and q.validation_status='rejected' and (sup or quizbox_market.question_allowed(q.id))),
   'disputed',(select count(distinct c.target_id) from public.content_reports c join public.questions q on q.id=c.target_id where c.target_type='question' and q.status::text<>'archived' and coalesce(c.status,'open')='open' and c.report_type in ('DISPUTE','QUESTION_ERROR')),
   'quality_queue',(select count(*) from public.content_reports c join public.questions q on q.id=c.target_id where c.target_type='question' and q.status::text<>'archived' and c.report_type='QUALITY_REVIEW' and coalesce(c.status,'open')='open'),
   'candidates',(select jsonb_object_agg(status,n) from (select status,count(*) n from quizbox_competition.candidates group by 1) c));
 elsif p_action='signals' then
  return coalesce((select jsonb_agg(jsonb_build_object('question_id',s.question_id,'question',left(q.question_text,140),'subject',q.subject_code,'grade',q.canonical_grade_code,'status',q.validation_status||'/'||q.status,
    'responses',s.responses,'accuracy',s.accuracy,'started',s.started,'abandoned',s.abandoned,'revisions',s.revisions,'disputes',s.disputes,'flags',to_jsonb(s.flags)) order by cardinality(s.flags) desc,s.responses desc)
   from quizbox_ops.question_signals(coalesce((p_data->>'min_responses')::integer,5)) s join public.questions q on q.id=s.question_id
   where q.status::text<>'archived' and (cardinality(s.flags)>0 or not coalesce((p_data->>'flagged_only')::boolean,true)) and (sup or quizbox_market.question_allowed(q.id)) limit 200),'[]');
 elsif p_action='flag' then
  if not exists(select 1 from public.questions q where q.id=(p_data->>'question_id')::uuid and (sup or quizbox_market.question_allowed(q.id))) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
  insert into public.content_reports(reporter_user_id,target_type,target_id,report_type,description,status)
  values(auth.uid(),'question',(p_data->>'question_id')::uuid,'QUALITY_REVIEW',left(coalesce(p_data->>'reason','Quality signal'),500),'open') returning * into rep;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_QUALITY_FLAG','questions',rep.target_id,'pass',jsonb_build_object('report_id',rep.id));
  return to_jsonb(rep);
 elsif p_action='queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'question_id',c.target_id,'question',left(q.question_text,140),'type',c.report_type,'reason',c.description,'created_at',c.created_at) order by c.created_at)
   from public.content_reports c join public.questions q on q.id=c.target_id where c.target_type='question' and q.status::text<>'archived' and coalesce(c.status,'open')='open' and c.report_type in ('QUALITY_REVIEW','DISPUTE','QUESTION_ERROR')
   and (sup or quizbox_market.question_allowed(q.id))),'[]');
 elsif p_action='resolve' then
  update public.content_reports set status='resolved',resolved_by=auth.uid(),resolved_at=now() where id=(p_data->>'report_id')::uuid and coalesce(status,'open')='open' returning * into rep;
  if rep.id is null then raise exception 'REPORT_NOT_OPEN'; end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_QUALITY_RESOLVED','content_reports',rep.id,'pass',jsonb_build_object('note',left(p_data->>'note',300)));
  return to_jsonb(rep);
 end if;
 raise exception 'INVALID_QUALITY_ACTION';
end $$;

-- qb_content_coverage was rewritten in place by 20261002210000 (market scoping), so its LIVE body is patched with checked
-- replacements instead of being re-declared from an older text. Any unexpected body aborts the migration unchanged.
do $patch$
declare
  f oid := 'public.qb_content_coverage(jsonb,integer,integer,integer)'::regprocedure; def text; n int;
  scope_cte constant text := 'scope as (select * from rows r where (coalesce(p_filters->>''curriculum'','''')='''' or r.curriculum_id::text=p_filters->>''curriculum'') and (coalesce(p_filters->>''grade'','''')='''' or coalesce(r.canonical_grade_code,r.grade_code)=p_filters->>''grade'') and (coalesce(p_filters->>''subject'','''')='''' or r.subject_code=p_filters->>''subject'')),';
begin
  def := pg_get_functiondef(f);
  if position('scope as (select * from rows r' in def) > 0 then raise notice 'qb_content_coverage already patched'; return; end if;
  -- 1. the summary indicator counts follow the selected curriculum / grade / subject (rows are narrowed into scope first)
  if position(' filtered as (' in def) = 0 then raise exception 'COVERAGE_BODY_CHANGED: filtered CTE'; end if;
  def := replace(def, ' filtered as (', ' ' || scope_cte || E'\n filtered as (');
  n := (length(def) - length(replace(def, 'from rows where node_type', ''))) / length('from rows where node_type');
  if n <> 4 then raise exception 'COVERAGE_BODY_CHANGED: expected 4 summary indicator counts, found %', n; end if;
  def := replace(def, 'from rows where node_type', 'from scope where node_type');
  -- 2. review / rejected / duplicate / approved counters ignore archived questions
  if position('not in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT''))' in def) = 0 then raise exception 'COVERAGE_BODY_CHANGED: production CTE'; end if;
  def := replace(def, 'not in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT''))', 'not in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'') and status::text<>''archived'')');
  -- 3. "Fixtures" counts only fixtures that are still live (not retired)
  if position(' source_type in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'')))) into result' in def) = 0 then raise exception 'COVERAGE_BODY_CHANGED: fixture counter'; end if;
  def := replace(def, ' source_type in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'')))) into result', ' source_type in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'') and status::text<>''archived''))) into result');
  execute def;
end $patch$;

commit;
