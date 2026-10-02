begin;
create or replace function public.qb_is_acceptance_actor() returns boolean language sql stable security definer set search_path='' as $function$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
 and lower(email) in ('student.test@quizbox.local','student2.test@quizbox.local','teacher.test@quizbox.local','admin.test@quizbox.local','sponsor.test@quizbox.local','seller.test@quizbox.local'));
$function$;
do $contract$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_content_validation_errors(jsonb)'::regprocedure);
 body:=replace(body,' return errors;', $fragment$
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
 return errors;$fragment$);
 execute body;
end $contract$;
notify pgrst,'reload schema';
commit;
