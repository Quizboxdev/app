begin;
alter table public.questions add column if not exists editorial_metadata jsonb not null default '{}';
alter table public.questions add column if not exists text_hash text;
alter table public.questions add column if not exists answer_hash text;
alter table public.questions add column if not exists option_signature text;
alter table public.questions add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.questions add column if not exists reviewed_at timestamptz;
alter table public.content_import_batches add column if not exists generation_spec jsonb;
alter table public.content_import_batches add column if not exists source_type text not null default 'IMPORTED';
alter table public.content_import_batches add column if not exists provider text;
alter table public.content_import_batches add column if not exists model_version text;

create or replace function public.qb_factory_normalize(p text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(normalize(coalesce(p,''),NFKC)),'[^[:alnum:]]+',' ','g'));
$$;
create or replace function public.qb_is_acceptance_actor() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid() and email ~ '^(student[0-9]*|teacher|admin|sponsor|seller)\.test@quizbox\.local$');
$$;
create or replace function public.qb_content_validation_errors(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare errors jsonb := '[]'; n public.curriculum_nodes; opts text[]; k text;
begin
 if jsonb_typeof(p)<>'object' then return '["MALFORMED_CANDIDATE"]'; end if;
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
   else for k in select value->>'type' from jsonb_array_elements(p#>'{question_content,blocks}') loop if k not in ('text','math') or k is null then errors:=errors||'"UNSUPPORTED_MEDIA"'::jsonb; end if; end loop; end if;
 end if;
 return errors;
exception when invalid_text_representation or numeric_value_out_of_range then return errors||'"MALFORMED_CANDIDATE"'::jsonb;
end $$;

create or replace function public.qb_question_is_available(q public.questions) returns boolean language sql stable security definer set search_path='' as $$
 select q.status='active' and q.validation_status='approved' and (q.tenant_id is null or q.tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(q.tenant_id) or public.qb_is_platform_admin())
 and ((q.source_type='DEV_ACCEPTANCE_FIXTURE' and public.qb_is_acceptance_actor() and exists(select 1 from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active and n.node_type in ('learning_indicator','learning_objective')))
 or (public.qb_content_validation_errors(to_jsonb(q))='[]'::jsonb and (coalesce(q.source_type,'') not in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') or public.qb_is_acceptance_actor())));
$$;

create or replace function public.qb_question_editorial_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean:=false; normalized text; correct_text text; options text[]; n public.curriculum_nodes;
begin
 if tg_op='UPDATE' then
  changed:=row(new.question_text,new.option_a,new.option_b,new.option_c,new.option_d,new.correct_answer,new.answer_spec,new.question_content,new.explanation,new.hint,new.curriculum_node_id,new.difficulty_label,new.cognitive_level,new.marks,new.estimated_time_seconds) is distinct from row(old.question_text,old.option_a,old.option_b,old.option_c,old.option_d,old.correct_answer,old.answer_spec,old.question_content,old.explanation,old.hint,old.curriculum_node_id,old.difficulty_label,old.cognitive_level,old.marks,old.estimated_time_seconds);
  if changed then
   insert into public.question_versions(question_id,version_no,snapshot,change_reason,created_by) values(old.id,old.version,to_jsonb(old),coalesce(new.editorial_metadata->>'change_note','Prior version'),auth.uid()) on conflict(question_id,version_no) do nothing;
   new.version:=old.version+1; new.validation_status:='review'; new.status:='inactive'; new.reviewed_by:=null; new.reviewed_at:=null;
  end if;
 end if;
 if coalesce(new.validation_status,'review') not in ('draft','generated','review','approved','rejected','needs_revision','validated') then raise exception 'QB_INVALID_EDITORIAL_STATE'; end if;
 if tg_op='INSERT' or new.curriculum_node_id is distinct from old.curriculum_node_id then
  select * into n from public.curriculum_nodes where id=new.curriculum_node_id;
  if n.id is not null then new.curriculum_id:=n.curriculum_id; new.subject_code:=n.subject_code; new.subject_name:=n.subject_code; new.grade:=coalesce(n.source_grade_code,n.grade_code)::public.qb_grade; new.source_grade_code:=n.source_grade_code; new.canonical_grade_code:=n.canonical_grade_code; new.indicator_code:=n.code; new.indicator_text:=n.title; end if;
 end if;
 if new.validation_status='approved' and (tg_op='INSERT' or old.validation_status is distinct from 'approved') and not (new.source_type='DEV_ACCEPTANCE_FIXTURE' and auth.jwt()->>'role'='service_role') then
  if public.qb_content_validation_errors(to_jsonb(new))<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  if new.reviewed_by is null or new.reviewed_at is null or new.editorial_metadata->>'human_reviewed' is distinct from 'true' then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
 end if;
 normalized:=public.qb_factory_normalize(new.question_text);
 options:=array[public.qb_factory_normalize(new.option_a),public.qb_factory_normalize(new.option_b),public.qb_factory_normalize(new.option_c),public.qb_factory_normalize(new.option_d)];
 correct_text:=coalesce(options[array_position(array['A','B','C','D'],new.correct_answer)],new.answer_spec::text,'');
 new.text_hash:=encode(extensions.digest(normalized,'sha256'),'hex');
 new.answer_hash:=encode(extensions.digest(normalized||'|'||correct_text,'sha256'),'hex');
 new.option_signature:=encode(extensions.digest(normalized||'|'||(select string_agg(x,'|' order by x) from unnest(options) x)||'|'||correct_text,'sha256'),'hex');
 new.updated_at:=now(); return new;
end $$;
drop trigger if exists qb_question_editorial_guard on public.questions;
create trigger qb_question_editorial_guard before insert or update on public.questions for each row execute function public.qb_question_editorial_guard();
create or replace function public.qb_question_version_capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.question_versions(question_id,version_no,snapshot,change_reason,created_by) values(new.id,new.version,to_jsonb(new),coalesce(new.editorial_metadata->>'change_note','Initial candidate'),auth.uid()) on conflict(question_id,version_no) do nothing;
 return new;
end $$;
drop trigger if exists qb_question_version_capture on public.questions;
create trigger qb_question_version_capture after insert or update on public.questions for each row execute function public.qb_question_version_capture();

-- Backfill signatures without changing content or editorial decisions.
update public.questions set text_hash=encode(extensions.digest(public.qb_factory_normalize(question_text),'sha256'),'hex') where text_hash is null;
create index if not exists questions_factory_text_hash_idx on public.questions(text_hash);
create index if not exists questions_factory_queue_idx on public.questions(validation_status,created_at desc,id) where status<>'archived';

create or replace function public.qb_content_ingest(p_spec jsonb,p_candidates jsonb,p_source_file text default 'candidate.json',p_provider text default 'human',p_model text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.content_import_batches; candidate jsonb; errors jsonb; n public.curriculum_nodes; inserted public.questions; digest text; idx integer:=0; valid integer:=0; rejected integer:=0; dup text; source text;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates) not between 1 and 100 or octet_length(p_candidates::text)>1000000 then raise exception 'QB_INVALID_BATCH'; end if;
 if length(coalesce(p_source_file,'')) not between 1 and 250 then raise exception 'QB_INVALID_BATCH'; end if;
 source:=coalesce(p_spec#>>'{provenance,source}','IMPORTED');
 if source not in ('AI_GENERATED','HUMAN_AUTHOR','IMPORTED','DEV_FACTORY_PILOT') then raise exception 'QB_INVALID_PROVENANCE'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_content_ingest:'||auth.uid()::text));
 digest:=encode(extensions.digest(p_spec::text||p_candidates::text,'sha256'),'hex');
 select * into batch from public.content_import_batches where source_hash=digest;
 if found then return jsonb_build_object('batch_id',batch.id,'replayed',true); end if;
 if (select count(*) from public.content_import_batches where imported_by=auth.uid() and started_at>now()-interval '1 minute')>=10 then raise exception 'QB_CONTENT_RATE_LIMIT'; end if;
 insert into public.content_import_batches(source_file,source_hash,imported_by,status,records_detected,generation_spec,source_type,provider,model_version) values(p_source_file,digest,auth.uid(),'IMPORTING',jsonb_array_length(p_candidates),p_spec,source,p_provider,p_model) returning * into batch;
 for candidate in select value from jsonb_array_elements(p_candidates) loop
  idx:=idx+1; candidate:=candidate||jsonb_build_object('source_type',source); errors:=public.qb_content_validation_errors(candidate);
  if coalesce(candidate->>'external_question_id','')='' then errors:=errors||'"MISSING_EXTERNAL_ID"'::jsonb; end if;
  if exists(select 1 from public.questions where external_question_id=candidate->>'external_question_id') then errors:=errors||'"EXTERNAL_ID_COLLISION"'::jsonb; end if;
  dup:=null; select coalesce(duplicate_group_id,'dup-'||text_hash) into dup from public.questions where text_hash=encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex') limit 1;
  if errors='[]'::jsonb then
   select * into n from public.curriculum_nodes where id=(candidate->>'curriculum_node_id')::uuid;
   insert into public.questions(external_question_id,question_code,curriculum_id,curriculum_node_id,subject_code,subject_name,grade,source_grade_code,canonical_grade_code,indicator_code,indicator_text,question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,answer_spec,question_content,explanation,hint,difficulty_label,difficulty_code,cognitive_level,marks,estimated_time_seconds,tags,source_type,source_version,curriculum_reference,validation_status,status,import_batch_id,duplicate_group_id,editorial_metadata)
   values(candidate->>'external_question_id',candidate->>'external_question_id',n.curriculum_id,n.id,n.subject_code,n.subject_code,coalesce(n.source_grade_code,n.grade_code)::public.qb_grade,n.source_grade_code,n.canonical_grade_code,n.code,n.title,candidate->>'question_text',coalesce(candidate->>'option_a',''),coalesce(candidate->>'option_b',''),coalesce(candidate->>'option_c',''),coalesce(candidate->>'option_d',''),candidate->>'correct_answer',candidate->>'answer_type',candidate->'answer_spec',candidate->'question_content',candidate->>'explanation',candidate->>'hint',candidate->>'difficulty_label',candidate->>'difficulty_label',candidate->>'cognitive_level',(candidate->>'marks')::numeric,(candidate->>'estimated_time_seconds')::integer,array(select jsonb_array_elements_text(coalesce(candidate->'tags','[]'::jsonb))),source,p_spec#>>'{provenance,sourceVersion}',n.code,'review','inactive',batch.id,dup,jsonb_build_object('structural_validated_at',now(),'human_reviewed',false,'provider',p_provider,'model',p_model,'warnings',jsonb_build_array('HUMAN_CHECK_DISTRACTORS_EXPLANATION_AND_ALIGNMENT'),'generated_state',case when source='AI_GENERATED' then 'generated' else 'draft' end)) returning * into inserted;
   valid:=valid+1;
   if dup is not null then update public.questions set duplicate_group_id=dup where text_hash=inserted.text_hash; end if;
  else rejected:=rejected+1; inserted.id:=null; end if;
  insert into public.question_import_staging(import_batch_id,row_number,external_source_id,normalized_payload,fingerprint,classification,issues,imported_question_id) values(batch.id,idx,candidate->>'external_question_id',candidate,encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex'),case when errors<>'[]'::jsonb then 'rejected' when dup is not null then 'warning' else 'valid' end,errors,inserted.id);
 end loop;
 update public.content_import_batches set status='COMPLETED',completed_at=now(),valid_records=valid,rejected_records=rejected,inserted_records=valid,duplicates_skipped=(select count(*) from public.question_import_staging where import_batch_id=batch.id and classification='warning'),report=jsonb_build_object('event','content.batch.completed','review_count',valid,'auto_approved',0) where id=batch.id;
 return jsonb_build_object('batch_id',batch.id,'valid',valid,'rejected',rejected,'approved',0);
end $$;

create or replace function public.qb_content_review(p_id uuid,p_action text,p_version integer,p_expected_state text,p_patch jsonb default '{}',p_note text default '',p_human_reviewed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.questions; errors jsonb; target text;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if length(trim(p_note)) not between 3 and 1000 then raise exception 'QB_REVIEW_NOTE_REQUIRED'; end if;
 select * into q from public.questions where id=p_id for update;
 if q.id is null then raise exception 'QB_QUESTION_NOT_FOUND'; end if;
 if q.version is distinct from p_version or q.validation_status is distinct from p_expected_state then raise exception 'QB_CONTENT_CONFLICT'; end if;
 if p_action='edit' then
  if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('question_text','option_a','option_b','option_c','option_d','correct_answer','answer_spec','explanation','hint','difficulty_label','cognitive_level','marks','estimated_time_seconds','question_content','curriculum_node_id')) then raise exception 'QB_INVALID_EDIT'; end if;
  errors:=public.qb_content_validation_errors(to_jsonb(q)||p_patch); if errors<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  update public.questions set question_text=coalesce(p_patch->>'question_text',q.question_text),option_a=coalesce(p_patch->>'option_a',q.option_a),option_b=coalesce(p_patch->>'option_b',q.option_b),option_c=coalesce(p_patch->>'option_c',q.option_c),option_d=coalesce(p_patch->>'option_d',q.option_d),correct_answer=coalesce(p_patch->>'correct_answer',q.correct_answer),answer_spec=coalesce(p_patch->'answer_spec',q.answer_spec),explanation=coalesce(p_patch->>'explanation',q.explanation),hint=coalesce(p_patch->>'hint',q.hint),difficulty_label=coalesce(p_patch->>'difficulty_label',q.difficulty_label),difficulty_code=coalesce(p_patch->>'difficulty_label',q.difficulty_code),cognitive_level=coalesce(p_patch->>'cognitive_level',q.cognitive_level),marks=coalesce((p_patch->>'marks')::numeric,q.marks),estimated_time_seconds=coalesce((p_patch->>'estimated_time_seconds')::integer,q.estimated_time_seconds),question_content=coalesce(p_patch->'question_content',q.question_content),curriculum_node_id=coalesce((p_patch->>'curriculum_node_id')::uuid,q.curriculum_node_id),editorial_metadata=q.editorial_metadata||jsonb_build_object('change_note',p_note) where id=q.id;
 elsif p_action='approve' then
  if q.validation_status<>'review' or p_human_reviewed is distinct from true then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
  errors:=public.qb_content_validation_errors(to_jsonb(q)); if errors<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  update public.questions set validation_status='approved',status='inactive',reviewed_by=auth.uid(),reviewed_at=now(),editorial_metadata=q.editorial_metadata||jsonb_build_object('human_reviewed',true,'review_note',p_note) where id=q.id;
 elsif p_action='publish' then
  if q.validation_status<>'approved' or q.reviewed_by is null or public.qb_content_validation_errors(to_jsonb(q))<>'[]'::jsonb then raise exception 'QB_CONTENT_NOT_APPROVED'; end if;
  update public.questions set status='active' where id=q.id;
 elsif p_action='archive' then update public.questions set status='archived' where id=q.id;
 elsif p_action in ('reject','revision','review') then
  target:=case p_action when 'reject' then 'rejected' when 'revision' then 'needs_revision' else 'review' end;
  update public.questions set validation_status=target,status='inactive',reviewed_by=null,reviewed_at=null,editorial_metadata=q.editorial_metadata||jsonb_build_object('review_note',p_note,'human_reviewed',false) where id=q.id;
 else raise exception 'QB_INVALID_REVIEW_ACTION'; end if;
 update public.content_import_batches set report=report||jsonb_build_object('last_event',jsonb_build_object('event','content.'||p_action,'question_id',q.id,'actor_id',auth.uid(),'at',now())) where id=q.import_batch_id;
 select * into q from public.questions where id=p_id;
 return jsonb_build_object('id',q.id,'version',q.version,'validation_status',q.validation_status,'status',q.status);
end $$;

create or replace function public.qb_content_queue(p_filters jsonb default '{}',p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if p_page<1 or p_limit not between 1 and 100 then raise exception 'QB_INVALID_PAGE'; end if;
 with matching as (select q.* from public.questions q left join public.curriculum_nodes n on n.id=q.curriculum_node_id where
 (coalesce(p_filters->>'search','')='' or q.question_text ilike '%'||left(p_filters->>'search',200)||'%')
 and (coalesce(p_filters->>'status','')='' or q.validation_status=p_filters->>'status') and (coalesce(p_filters->>'grade','')='' or q.canonical_grade_code=p_filters->>'grade' or q.grade::text=p_filters->>'grade')
 and (coalesce(p_filters->>'subject','')='' or q.subject_code=p_filters->>'subject') and (coalesce(p_filters->>'source','')='' or q.source_type=p_filters->>'source')
 and (coalesce(p_filters->>'difficulty','')='' or q.difficulty_label=p_filters->>'difficulty') and (coalesce(p_filters->>'cognitive','')='' or q.cognitive_level=p_filters->>'cognitive')
 and (coalesce(p_filters->>'type','')='' or q.answer_type=p_filters->>'type') and (coalesce(p_filters->>'batch','')='' or q.import_batch_id::text=p_filters->>'batch')
 and (coalesce(p_filters->>'curriculum','')='' or n.curriculum_id::text=p_filters->>'curriculum')
 and (coalesce(p_filters->>'node','')='' or q.curriculum_node_id in (with recursive branch as (select id from public.curriculum_nodes where id::text=p_filters->>'node' union select n.id from public.curriculum_nodes n join branch b on n.parent_id=b.id) select id from branch)))
 select jsonb_build_object('total',(select count(*) from matching),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,question_text,subject_code,grade,validation_status,status,answer_type,difficulty_label,cognitive_level,source_type,version,import_batch_id,duplicate_group_id,indicator_code from matching order by created_at desc,id limit p_limit offset (p_page-1)*p_limit) r),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function public.qb_content_coverage(p_filters jsonb default '{}',p_page integer default 1,p_limit integer default 25,p_target integer default 10)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if p_page<1 or p_limit not between 1 and 100 or p_target not between 1 and 1000 then raise exception 'QB_INVALID_PAGE'; end if;
 with recursive nodes as (select * from public.curriculum_nodes where is_active),
 paths as (select id leaf,id ancestor,parent_id parent,array[id] trail from nodes union all select p.leaf,n.id,n.parent_id,p.trail||n.id from paths p join nodes n on n.id=p.parent where not n.id=any(p.trail)),
 production as (select * from public.questions where coalesce(source_type,'') not in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')),
 counts as (select p.ancestor,count(q.id) total,count(q.id) filter(where q.validation_status='approved' and q.status='active') approved,count(q.id) filter(where coalesce(q.validation_status,'review') in ('draft','generated','review','needs_revision')) review,count(q.id) filter(where q.validation_status='rejected') rejected,count(q.id) filter(where q.duplicate_group_id is not null) duplicates,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='easy') easy,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='medium') medium,count(q.id) filter(where q.validation_status='approved' and q.status='active' and q.difficulty_label='hard') hard from paths p join production q on q.curriculum_node_id=p.leaf group by p.ancestor),
 indicators as (select p.ancestor,count(*) indicators from paths p join nodes n on n.id=p.leaf where n.node_type in ('learning_indicator','learning_objective') group by p.ancestor),
 rows as (select n.id,n.parent_id,n.curriculum_id,n.node_type,n.code,n.title,n.grade_code,n.subject_code,coalesce(c.total,0) total,coalesce(c.approved,0) approved,coalesce(c.review,0) review,coalesce(c.rejected,0) rejected,coalesce(c.duplicates,0) duplicates,coalesce(c.easy,0) easy,coalesce(c.medium,0) medium,coalesce(c.hard,0) hard,coalesce(i.indicators,0) indicators,case when coalesce(c.approved,0)=0 then 'Empty' when c.approved<greatest(coalesce(i.indicators,1),1)*3 then 'Critical' when c.approved<greatest(coalesce(i.indicators,1),1)*p_target then 'Thin' when c.approved<greatest(coalesce(i.indicators,1),1)*20 then 'Adequate' else 'Strong' end health from nodes n left join counts c on c.ancestor=n.id left join indicators i on i.ancestor=n.id),
 filtered as (select * from rows r where (coalesce(p_filters->>'grade','')='' or r.grade_code=p_filters->>'grade') and (coalesce(p_filters->>'subject','')='' or r.subject_code=p_filters->>'subject') and (coalesce(p_filters->>'curriculum','')='' or r.curriculum_id::text=p_filters->>'curriculum') and (coalesce(p_filters->>'type','')='' or r.node_type=p_filters->>'type') and (coalesce(p_filters->>'parent','')='' or r.parent_id::text=p_filters->>'parent') and (coalesce(p_filters->>'search','')='' or (r.code||' '||r.title) ilike '%'||left(p_filters->>'search',200)||'%'))
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from filtered order by grade_code,subject_code,code,id limit p_limit offset (p_page-1)*p_limit) r),'[]'::jsonb),'summary',jsonb_build_object('totalIndicators',(select count(*) from rows where node_type in ('learning_indicator','learning_objective')),'zeroApproved',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved=0),'belowTarget',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved<p_target),'meetingTarget',(select count(*) from rows where node_type in ('learning_indicator','learning_objective') and approved>=p_target),'productionApproved',(select count(*) from production where validation_status='approved' and status='active'),'reviewQueue',(select count(*) from production where coalesce(validation_status,'review') in ('draft','generated','review','needs_revision')),'rejected',(select count(*) from production where validation_status='rejected'),'duplicateCandidates',(select count(*) from production where duplicate_group_id is not null),'fixtureQuestions',(select count(*) from public.questions where source_type in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')))) into result;
 return result;
end $$;

create or replace function public.qb_content_request_generation(p_spec jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.curriculum_nodes; batch uuid; hash text;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 select * into n from public.curriculum_nodes where id=(p_spec->>'indicatorId')::uuid and node_type in ('learning_indicator','learning_objective') and is_active;
 if n.id is null or p_spec->>'indicatorCode' is distinct from n.code or p_spec->>'curriculumId' is distinct from n.curriculum_id::text or coalesce((p_spec->>'count')::integer,0) not between 1 and 100 then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_content_generation:'||auth.uid()::text));
 hash:=encode(extensions.digest('generation:'||p_spec::text,'sha256'),'hex');
 select id into batch from public.content_import_batches where source_hash=hash;
 if batch is not null then return jsonb_build_object('batch_id',batch,'replayed',true); end if;
 if (select count(*) from public.content_import_batches where imported_by=auth.uid() and started_at>now()-interval '1 minute')>=10 then raise exception 'QB_CONTENT_RATE_LIMIT'; end if;
 insert into public.content_import_batches(source_file,source_hash,imported_by,status,records_detected,generation_spec,source_type,provider,report) values('generation-request',hash,auth.uid(),'PREVIEW',(p_spec->>'count')::integer,p_spec,'AI_GENERATED','not-configured',jsonb_build_object('event','content.generation.requested','state','awaiting_provider','auto_approved',0)) returning id into batch;
 return jsonb_build_object('batch_id',batch,'state','awaiting_provider');
end $$;
revoke all on function public.qb_content_coverage(jsonb,integer,integer,integer),public.qb_content_request_generation(jsonb) from public,anon;
grant execute on function public.qb_content_coverage(jsonb,integer,integer,integer),public.qb_content_request_generation(jsonb) to authenticated;
create or replace function public.qb_content_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.questions;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 select * into q from public.questions where id=p_id; if q.id is null then raise exception 'QB_QUESTION_NOT_FOUND'; end if;
 return jsonb_build_object('question',to_jsonb(q),'validation_errors',public.qb_content_validation_errors(to_jsonb(q)),'mapping',(select to_jsonb(n) from public.curriculum_nodes n where n.id=q.curriculum_node_id),'versions',coalesce((select jsonb_agg(jsonb_build_object('version',version_no,'at',created_at,'editor',created_by,'reason',change_reason) order by version_no desc) from public.question_versions where question_id=q.id),'[]'::jsonb));
end $$;

alter table public.question_versions enable row level security;
create policy question_versions_content_admin on public.question_versions for select to authenticated using(public.qb_is_platform_admin());
grant select on public.question_versions to authenticated;
drop policy if exists questions_authenticated_read on public.questions;
create policy questions_authorized_teacher_read on public.questions for select to authenticated using(upper(public.qb_current_role())='TEACHER' and public.qb_question_is_available(questions) and (tenant_id is null or tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(tenant_id)));
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;
drop policy if exists attempts_student_self on public.attempts;
create policy attempts_student_read on public.attempts for select to authenticated using(student_user_id=auth.uid());
revoke insert,update,delete on public.attempts from authenticated,anon;
alter table public.responses enable row level security;
create policy responses_student_safe_read on public.responses for select to authenticated using(exists(select 1 from public.attempts t where t.id=attempt_id and t.student_user_id=auth.uid()));
revoke all on public.responses from authenticated,anon;
grant select(id,attempt_id,assignment_id,question_id,selected_answer,selected_value,answered_at) on public.responses to authenticated;
alter table public.assessment_results enable row level security;
create policy assessment_results_owner_read on public.assessment_results for select to authenticated using(student_user_id=auth.uid());
revoke insert,update,delete on public.assessment_results from authenticated,anon;

-- Tighten authorization/input checks without changing the accepted RPC bodies or grading algorithms.
do $$
declare f record; body text;
begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_get_attempt','qb_get_attempt_review','qb_get_result','qb_save_response','qb_submit_attempt','qb_complete_attempt','qb_start_attempt','qb_publish_assignment') loop
  body:=pg_get_functiondef(f.oid);
  if position('QB_AUTHENTICATION_REQUIRED' in body)=0 then body:=regexp_replace(body,'\mbegin\M',E'begin\n if auth.uid() is null then raise exception ''QB_AUTHENTICATION_REQUIRED''; end if;','i'); end if;
  body:=replace(body,'v_attempt.student_id <> v_student_id','v_attempt.student_id is distinct from v_student_id');
  body:=replace(body,'r.student_id <> v_student_id','r.student_id is distinct from v_student_id');
  body:=replace(body,'v_attempt.student_user_id <> auth.uid()','v_attempt.student_user_id is distinct from auth.uid()');
  if f.proname='qb_publish_assignment' and position('create temporary table qb_selected_questions' in body)>0 then
   body:=replace(body,'create temporary table qb_selected_questions',E'if p_question_count is null or p_attempts_allowed is null or p_time_limit_minutes is null or p_attempts_allowed>10 or p_time_limit_minutes>180 or nullif(trim(p_title),'''') is null or coalesce(cardinality(p_curriculum_node_ids),0) not between 1 and 100 or p_mode not in (''PRACTICE'',''ASSESSMENT'') or p_selection_mode not in (''MANUAL'',''AUTOMATIC'') then raise exception ''QB_INVALID_ASSIGNMENT_INPUT''; end if;\n if p_target_student_ids is not null and (cardinality(p_target_student_ids)=0 or exists(select 1 from unnest(p_target_student_ids) u where u is null or not exists(select 1 from public.class_memberships m where m.class_id=p_class_id and m.student_user_id=u and m.status=''active''))) then raise exception ''QB_INVALID_TARGETS''; end if;\n if p_selection_mode=''MANUAL'' and (coalesce(cardinality(p_question_ids),0)<>p_question_count or (select count(distinct x) from unnest(p_question_ids) x)<>p_question_count) then raise exception ''QB_INVALID_SELECTION''; end if;\n create temporary table qb_selected_questions');
   body:=replace(body,'where q.status = ''active''','where q.status = ''active'' and public.qb_question_is_available(q) and (q.tenant_id is null or q.tenant_id=v_class.tenant_id) and (coalesce(q.source_type,'''') not in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'') or v_class.class_name=''QuizBox Developer Acceptance Class'')');
  end if;
  execute body;
  execute format('revoke all on function %s from public, anon',f.oid::regprocedure);
  execute format('grant execute on function %s to authenticated',f.oid::regprocedure);
 end loop;
end $$;
do $$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_can_access_learning_assessment(uuid)'::regprocedure);
 body:=replace(body,'and (a.tenant_id=',E'and not exists(select 1 from public.assessment_questions aq join public.questions q on q.id=aq.question_id where aq.assessment_id=a.id and q.source_type in (''DEV_ACCEPTANCE_FIXTURE'',''DEV_FACTORY_PILOT'') and not public.qb_is_acceptance_actor())\n and (a.tenant_id=');
 execute body;
 body:=pg_get_functiondef('public.qb_question_availability(uuid[],text,text)'::regprocedure);
 body:=replace(body,'from public.questions q','from public.questions q');
 body:=replace(body,'where q.status', 'where public.qb_question_is_available(q) and q.status');
 execute body;
end $$;

-- New APIs are admin-authorized; helpers carry no question data and have explicit grants.
revoke all on function public.qb_factory_normalize(text),public.qb_is_acceptance_actor(),public.qb_content_validation_errors(jsonb),public.qb_question_is_available(public.questions),public.qb_question_editorial_guard(),public.qb_question_version_capture(),public.qb_content_ingest(jsonb,jsonb,text,text,text),public.qb_content_review(uuid,text,integer,text,jsonb,text,boolean),public.qb_content_queue(jsonb,integer,integer),public.qb_content_detail(uuid) from public,anon;
grant execute on function public.qb_factory_normalize(text),public.qb_is_acceptance_actor(),public.qb_content_validation_errors(jsonb),public.qb_question_is_available(public.questions),public.qb_content_ingest(jsonb,jsonb,text,text,text),public.qb_content_review(uuid,text,integer,text,jsonb,text,boolean),public.qb_content_queue(jsonb,integer,integer),public.qb_content_detail(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
