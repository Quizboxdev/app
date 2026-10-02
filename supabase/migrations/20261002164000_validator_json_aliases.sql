begin;
do $aliases$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_content_validation_errors(jsonb)'::regprocedure);
 body:=replace(body,'jsonb_object_keys(p->''question_content'') k where k<>''blocks''','jsonb_object_keys(p->''question_content'') content_keys(key_name) where content_keys.key_name<>''blocks''');
 body:=replace(body,E'else ''{}''::jsonb end) k\n where k<>all',E'else ''{}''::jsonb end) block_keys(key_name)\n where block_keys.key_name<>all');
 execute body;
end $aliases$;
notify pgrst,'reload schema';
commit;
