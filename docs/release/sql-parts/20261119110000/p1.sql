-- Four topic names a learner sees were mis-typed in the loaded curriculum (Spark run rows 11 and 12). Only the title text changes; codes, identity keys, parents and questions are untouched.
--   English Language B4, B5, B6 sub-strand "Conversation - Talking about Oneself, Family, People, Customs,"  ->  no trailing comma
--   English Language B5 sub-strand "Using action Words"                                                        ->  "Using Action Words" (B4 and B6 already read this way)
--   Creative Arts B5 Visual Arts sub-strand "Planning, Making And Composing"                                  ->  "Planning, Making and Composing" (the other grades and strand read this way)
-- Each change matches the exact old text, so it only touches what was found and running it again changes nothing. Rollback: supabase/rollback/topic_title_fixes.sql.
begin;

update public.curriculum_nodes set title = 'Conversation - Talking about Oneself, Family, People, Customs'
 where node_type = 'sub_strand' and subject_code = 'English Language' and grade_code in ('B4', 'B5', 'B6') and title = 'Conversation - Talking about Oneself, Family, People, Customs,';

update public.curriculum_nodes set title = 'Using Action Words'
 where node_type = 'sub_strand' and subject_code = 'English Language' and grade_code = 'B5' and title = 'Using action Words';

update public.curriculum_nodes set title = 'Planning, Making and Composing'
 where node_type = 'sub_strand' and subject_code = 'Creative Arts' and grade_code = 'B5' and title = 'Planning, Making And Composing';

commit;
notify pgrst, 'reload schema';
