begin;
do $content$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_content_validation_errors(jsonb)'::regprocedure);
 body:=replace(body,' return errors;', $fragment$
 if jsonb_typeof(p->'question_content')='object' and exists(select 1 from jsonb_object_keys(p->'question_content') k where k<>'blocks') then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b
 cross join lateral jsonb_object_keys(case when jsonb_typeof(b)='object' then b else '{}'::jsonb end) k
 where k<>all(case when b->>'type'='text' then array['type','text'] else array['type','latex','display'] end)) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where b->>'type'='text' and b->>'text' ~* '(correct answer|answer key|the answer is)') then errors:=errors||'"ANSWER_LEAKAGE"'::jsonb; end if;
 return errors;$fragment$);
 execute body;
end $content$;
notify pgrst,'reload schema';
commit;
