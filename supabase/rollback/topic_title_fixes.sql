-- Rollback for 20261119110000_topic_title_fixes.sql: puts the four old titles back (only where the corrected text is now present).
begin;
update public.curriculum_nodes set title = 'Conversation - Talking about Oneself, Family, People, Customs,'
 where node_type = 'sub_strand' and subject_code = 'English Language' and grade_code in ('B4', 'B5', 'B6') and title = 'Conversation - Talking about Oneself, Family, People, Customs';
update public.curriculum_nodes set title = 'Using action Words'
 where node_type = 'sub_strand' and subject_code = 'English Language' and grade_code = 'B5' and title = 'Using Action Words';
update public.curriculum_nodes set title = 'Planning, Making And Composing'
 where node_type = 'sub_strand' and subject_code = 'Creative Arts' and grade_code = 'B5' and title = 'Planning, Making and Composing'
   and parent_id in (select id from public.curriculum_nodes where title = 'Visual Arts');
commit;
notify pgrst, 'reload schema';
