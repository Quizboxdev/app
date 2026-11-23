begin;

-- Puts the eight family guides back to draft (they disappear from Help and from search at once). Nothing is deleted.
update public.help_articles
   set state = 'draft', updated_at = now()
 where slug in ('family-workspace-start', 'add-a-child', 'link-an-existing-student', 'child-workspace-link', 'give-work-to-children', 'pay-for-children', 'family-question-library', 'family-challenges')
   and state = 'published';

commit;
