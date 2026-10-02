-- Durable editorial density targets, and private validated question media.
-- Depends on production_readiness_security.
create function quizbox_private.resolve_target(p_curriculum uuid,p_grade text,p_subject text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('minimum',minimum,'easy',easy,'medium',medium,'hard',hard,'type_mix',type_mix)
 from public.content_coverage_targets where curriculum_id=p_curriculum and grade_code in ('',coalesce(p_grade,'')) and subject_code in ('',coalesce(p_subject,''))
 order by ((grade_code<>'')::integer+(subject_code<>'')::integer) desc,(subject_code<>'') desc,id limit 1),
 '{"minimum":10,"easy":3,"medium":4,"hard":3,"type_mix":{"SINGLE_CHOICE":8,"TRUE_FALSE":2}}'::jsonb);
$$;
alter table public.media_assets add column if not exists byte_size integer check(byte_size between 1 and 5242880),
 add column if not exists validated_at timestamptz;
create function public.qb_can_read_question_media(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 public.qb_is_platform_admin() or exists(
 select 1 from public.attempts a join public.assessment_questions aq on aq.assessment_id=a.assessment_id
 cross join lateral jsonb_array_elements(coalesce(aq.media_snapshot,'[]'::jsonb)) m
 where a.student_user_id=auth.uid() and m->>'storage_bucket'='question-media' and m->>'storage_path'=p_path
 and upper(coalesce(m->>'usage_type','QUESTION')) in ('QUESTION','OPTION')));
$$;
create policy question_media_attempt_read on storage.objects for select to authenticated
 using(bucket_id='question-media' and public.qb_can_read_question_media(name));
update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg','image/webp'] where id='question-media' and not public;

create function public.qb_attach_question_media(p_question_id uuid,p_asset_id uuid,p_version integer,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.questions; a public.media_assets; blocks jsonb; result jsonb;
begin
 if not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;
 perform quizbox_private.enforce_budget('media_attach',30,60);
 select * into q from public.questions where id=p_question_id for update;
 select * into a from public.media_assets where id=p_asset_id;
 if q.id is null or a.id is null or a.validated_at is null or a.created_by<>auth.uid() or a.storage_bucket<>'question-media' or a.mime_type not in ('image/png','image/jpeg','image/webp') or a.byte_size not between 1 and 5242880 or a.width not between 1 and 4096 or a.height not between 1 and 4096 or a.status<>'ACTIVE' then raise exception 'QB_INVALID_MEDIA'; end if;
 if a.alt_text is null or length(a.alt_text) not between 1 and 300 or a.alt_text ~* '(correct answer|answer key|the answer is)|<[^>]*>' then raise exception 'QB_INVALID_MEDIA'; end if;
 blocks:=coalesce(q.question_content->'blocks',jsonb_build_array(jsonb_build_object('type','text','text',q.question_text)));
 if jsonb_array_length(blocks)>=30 then raise exception 'QB_INVALID_MEDIA'; end if;
 result:=public.qb_content_review(q.id,'edit',p_version,q.validation_status,jsonb_build_object('question_content',jsonb_build_object('blocks',blocks||jsonb_build_array(jsonb_build_object('type','image','asset_id',a.id,'alt',a.alt_text)))),p_note,false);
 insert into public.question_media(question_id,media_asset_id,usage_type,display_order) values(q.id,a.id,'QUESTION',jsonb_array_length(blocks)+1);
 return result;
end $$;
revoke all on function public.qb_can_read_question_media(text),public.qb_attach_question_media(uuid,uuid,integer,text) from public,anon;
grant execute on function public.qb_can_read_question_media(text),public.qb_attach_question_media(uuid,uuid,integer,text) to authenticated,service_role;
revoke all on all functions in schema quizbox_private from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.qb_content_coverage(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_limit integer DEFAULT 25, p_target integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if p_page is null or p_page<1 or p_page>100000 or p_limit is null or p_limit not between 1 and 100 or p_target is null or p_target not between 1 and 1000 then raise exception 'QB_INVALID_PAGE'; end if;
 with recursive nodes as (select * from public.curriculum_nodes where is_active),
 paths as (select id leaf,id ancestor,parent_id parent,array[id] trail from nodes union all select p.leaf,n.id,n.parent_id,p.trail||n.id from paths p join nodes n on n.id=p.parent where not n.id=any(p.trail)),
 production as (select * from public.questions where coalesce(source_type,'') not in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')),
 counts as (select p.ancestor,count(q.id) total,count(q.id) filter(where q.validation_status='approved' and q.status='active') approved,count(q.id) filter(where coalesce(q.validation_status,'review') in ('draft','generated','review','needs_revision')) review,count(q.id) filter(where q.validation_status='rejected') rejected,count(q.id) filter(where q.duplicate_group_id is not null) duplicates,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='easy') easy,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='medium') medium,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='hard') hard from paths p join production q on q.curriculum_node_id=p.leaf group by p.ancestor),
 indicators as (select p.ancestor,count(*) indicators from paths p join nodes n on n.id=p.leaf where n.node_type in ('learning_indicator','learning_objective') group by p.ancestor),
 target_counts as (select p.ancestor,sum((t->>'minimum')::integer) target_total,sum((t->>'easy')::integer) easy_target,sum((t->>'medium')::integer) medium_target,sum((t->>'hard')::integer) hard_target from paths p join nodes n on n.id=p.leaf cross join lateral quizbox_private.resolve_target(n.curriculum_id,coalesce(n.canonical_grade_code,n.grade_code),n.subject_code) t where n.node_type in ('learning_indicator','learning_objective') group by p.ancestor),
 rows as (select coalesce(tc.target_total,p_target) target_total,coalesce(tc.easy_target,3) easy_target,coalesce(tc.medium_target,4) medium_target,coalesce(tc.hard_target,3) hard_target,n.id,n.parent_id,n.curriculum_id,n.node_type,n.code,n.title,n.grade_code,n.canonical_grade_code,n.source_grade_code,n.education_level,n.subject_code,coalesce(c.total,0) total,coalesce(c.approved,0) approved,coalesce(c.review,0) review,coalesce(c.rejected,0) rejected,coalesce(c.duplicates,0) duplicates,coalesce(c.easy,0) easy,coalesce(c.medium,0) medium,coalesce(c.hard,0) hard,coalesce(i.indicators,0) indicators,case when coalesce(c.approved,0)=0 then 'Empty' when c.approved<coalesce(tc.easy_target,3) then 'Critical' when c.approved<coalesce(tc.target_total,p_target) then 'Thin' when c.approved<coalesce(tc.target_total,p_target)*2 then 'Adequate' else 'Strong' end health from nodes n left join counts c on c.ancestor=n.id left join indicators i on i.ancestor=n.id left join target_counts tc on tc.ancestor=n.id),
 filtered as (select * from rows r where (coalesce(p_filters->>'grade','')='' or coalesce(r.canonical_grade_code,r.grade_code)=p_filters->>'grade') and (coalesce(p_filters->>'subject','')='' or r.subject_code=p_filters->>'subject') and (coalesce(p_filters->>'curriculum','')='' or r.curriculum_id::text=p_filters->>'curriculum') and (coalesce(p_filters->>'type','')='' or r.node_type=p_filters->>'type') and (coalesce(p_filters->>'parent','')='' or r.parent_id::text=p_filters->>'parent') and (coalesce(p_filters->>'search','')='' or (r.code||' '||r.title) ilike '%'||left(p_filters->>'search',200)||'%'))
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from filtered order by grade_code,subject_code,code,id limit p_limit offset (p_page-1)*p_limit) r),'[]'::jsonb),'summary',jsonb_build_object('totalIndicators',(select count(*) from rows where node_type in ('learning_indicator','learning_objective')),'zeroApproved',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved=0),'belowTarget',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved<target_total),'meetingTarget',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved>=target_total),'productionApproved',(select count(*) from production where validation_status='approved' and status='active'),'reviewQueue',(select count(*) from production where coalesce(validation_status,'review') in ('draft','generated','review','needs_revision')),'rejected',(select count(*) from production where validation_status='rejected'),'duplicateCandidates',(select count(*) from production where duplicate_group_id is not null),'fixtureQuestions',(select count(*) from public.questions where source_type in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')))) into result;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_content_validation_errors(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare errors jsonb := '[]'; n public.curriculum_nodes; opts text[]; k text;
begin
 if jsonb_typeof(p) is distinct from 'object' then return '["MALFORMED_CANDIDATE"]'; end if;
 begin select * into n from public.curriculum_nodes where id=(p->>'curriculum_node_id')::uuid; exception when invalid_text_representation then null; end;
 if n.id is null or not n.is_active or n.node_type not in ('learning_indicator','learning_objective') then errors:=errors||'"INVALID_INDICATOR"'::jsonb; end if;
 if length(trim(coalesce(p->>'question_text','')))=0 then errors:=errors||'"EMPTY_QUESTION"'::jsonb; end if;
 if coalesce(p->>'question_text','') ~* '(correct answer|answer key|the answer is)' then errors:=errors||'"ANSWER_LEAKAGE"'::jsonb; end if;
 if coalesce(p->>'question_text','') ~* '<[^>]*>|javascript:|data:' then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if p->>'answer_type'='SINGLE_CHOICE' then
   opts:=array[p->>'option_a',p->>'option_b',p->>'option_c',p->>'option_d'];
   if exists(select 1 from unnest(opts) x where nullif(trim(x),'') is null) then errors:=errors||'"EMPTY_OPTION"'::jsonb; end if;
   if (select count(distinct public.qb_factory_normalize(x)) from unnest(opts) x)<>4 then errors:=errors||'"DUPLICATE_OPTIONS"'::jsonb; end if;
   if coalesce(p->>'correct_answer','') not in ('A','B','C','D') then errors:=errors||'"INVALID_ANSWER"'::jsonb; end if;
 elsif p->>'answer_type'='TRUE_FALSE' then
   if jsonb_typeof(p#>'{answer_spec,boolean}') is distinct from 'boolean' or p->>'correct_answer' is distinct from (case when p#>>'{answer_spec,boolean}'='true' then 'A' else 'B' end) or lower(p->>'option_a') is distinct from 'true' or lower(p->>'option_b') is distinct from 'false' then errors:=errors||'"INVALID_BOOLEAN_ANSWER"'::jsonb; end if;
   if p->>'question_text' ~* '\mnot\M.*\m(not|never|no)\M' then errors:=errors||'"DOUBLE_NEGATIVE"'::jsonb; end if;
 elsif p->>'answer_type' in ('NUMERIC','FRACTION','MULTIPLE_CHOICE','SHORT_TEXT','EXPRESSION') then
   if jsonb_typeof(p->'answer_spec') is distinct from 'object' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='NUMERIC' and jsonb_typeof(p#>'{answer_spec,value}') is distinct from 'number' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='FRACTION' and (jsonb_typeof(p#>'{answer_spec,numerator}') is distinct from 'number' or jsonb_typeof(p#>'{answer_spec,denominator}') is distinct from 'number' or (p#>>'{answer_spec,denominator}')::numeric=0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='MULTIPLE_CHOICE' and (jsonb_typeof(p#>'{answer_spec,correct_options}') is distinct from 'array' or jsonb_array_length(p#>'{answer_spec,correct_options}')=0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type' in ('SHORT_TEXT','EXPRESSION') and coalesce(p#>>'{answer_spec,value}',p#>>'{answer_spec,canonical}',p#>>'{answer_spec,accepted,0}','')='' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 else errors:=errors||'"UNSUPPORTED_ANSWER_TYPE"'::jsonb; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then errors:=errors||'"MISSING_EXPLANATION"'::jsonb; end if;
 if coalesce(p->>'difficulty_label',p->>'difficulty_code','') not in ('easy','medium','hard') then errors:=errors||'"INVALID_DIFFICULTY"'::jsonb; end if;
 if coalesce((p->>'marks')::numeric,0)<=0 or (p->>'marks')::numeric>100 then errors:=errors||'"INVALID_MARKS"'::jsonb; end if;
 if coalesce((p->>'estimated_time_seconds')::integer,0) not between 5 and 3600 then errors:=errors||'"INVALID_DURATION"'::jsonb; end if;
 if coalesce(p->>'source_type','')='' or coalesce(p->>'cognitive_level','')='' then errors:=errors||'"MISSING_PROVENANCE_OR_COGNITIVE_LEVEL"'::jsonb; end if;
 if p->'question_content' is not null and p->'question_content'<>'null'::jsonb then
   if jsonb_typeof(p->'question_content')<>'object' or jsonb_typeof(p#>'{question_content,blocks}') is distinct from 'array' then errors:=errors||'"UNSAFE_CONTENT"'::jsonb;
   else for k in select value->>'type' from jsonb_array_elements(p#>'{question_content,blocks}') loop if k not in ('text','math','image') or k is null then errors:=errors||'"UNSUPPORTED_MEDIA"'::jsonb; end if; end loop; end if;
 end if;

 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where
 (b->>'type'='text' and (jsonb_typeof(b->'text') is distinct from 'string' or b->>'text' ~* '<[^>]*>|javascript:|data:')) or
 (b->>'type'='math' and (jsonb_typeof(b->'latex') is distinct from 'string' or b->>'latex' ~* '\\(href|html|includegraphics)'))) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;

 if jsonb_typeof(p->'question_content')='object' and exists(select 1 from jsonb_object_keys(p->'question_content') content_keys(key_name) where content_keys.key_name<>'blocks') then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b
 cross join lateral jsonb_object_keys(case when jsonb_typeof(b)='object' then b else '{}'::jsonb end) block_keys(key_name)
 where block_keys.key_name<>all(case when b->>'type'='text' then array['type','text'] when b->>'type'='image' then array['type','asset_id','alt'] else array['type','latex','display'] end)) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where b->>'type'='text' and b->>'text' ~* '(correct answer|answer key|the answer is)') then errors:=errors||'"ANSWER_LEAKAGE"'::jsonb; end if;

 if length(coalesce(p->>'external_question_id','')) not between 1 and 250 then errors:=errors||'"INVALID_EXTERNAL_ID"'::jsonb; end if;
 if p->>'answer_type'='NUMERIC' and p->'answer_spec' ? 'tolerance' and
 (jsonb_typeof(p#>'{answer_spec,tolerance}') is distinct from 'number' or (p#>>'{answer_spec,tolerance}')::numeric<0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 if p->>'answer_type' in ('SHORT_TEXT','EXPRESSION') then
  if p->'answer_spec' ? 'accepted' then
   if jsonb_typeof(p#>'{answer_spec,accepted}') is distinct from 'array' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif jsonb_array_length(p#>'{answer_spec,accepted}')=0 or exists(select 1 from jsonb_array_elements(p#>'{answer_spec,accepted}') a where jsonb_typeof(a)<>'string' or nullif(trim(a#>>'{}'),'') is null) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
  elsif nullif(trim(p#>>array['answer_spec',case when p->>'answer_type'='SHORT_TEXT' then 'value' else 'canonical' end]),'') is null then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 end if;
 if p->>'answer_type'='MULTIPLE_CHOICE' and jsonb_typeof(p#>'{answer_spec,correct_options}')='array' then
  if exists(select 1 from jsonb_array_elements(p#>'{answer_spec,correct_options}') a where jsonb_typeof(a)<>'string' or upper(a#>>'{}') not in ('A','B','C','D'))
  or (select count(distinct upper(a#>>'{}')) from jsonb_array_elements(p#>'{answer_spec,correct_options}') a)<>jsonb_array_length(p#>'{answer_spec,correct_options}')
  or exists(select 1 from unnest(array[p->>'option_a',p->>'option_b',p->>'option_c',p->>'option_d']) x where nullif(trim(x),'') is null)
  then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 end if;

 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where b->>'type'='image' and (
 jsonb_typeof(b->'asset_id') is distinct from 'string' or coalesce(b->>'alt','')='' or b->>'alt' ~* '(correct answer|answer key|the answer is)|<[^>]*>' or not exists(
 select 1 from public.media_assets ma where ma.id=(b->>'asset_id')::uuid and ma.validated_at is not null and ma.byte_size between 1 and 5242880 and ma.width between 1 and 4096 and ma.height between 1 and 4096 and ma.storage_bucket='question-media' and ma.status='ACTIVE' and ma.mime_type in ('image/png','image/jpeg','image/webp')
 ))) then errors:=errors||'"UNSUPPORTED_MEDIA"'::jsonb; end if;
 return errors;
exception when invalid_text_representation or numeric_value_out_of_range then return errors||'"MALFORMED_CANDIDATE"'::jsonb;
end $function$
;
