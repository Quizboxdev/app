-- Publish the eight family guides as one set: open the family workspace, add a child, link an existing student, open your family link (for the child),
-- give work, pay for children, give a question set, invite children to a challenge. They were written and corrected earlier and kept as drafts until the Family workspace is open.
-- Rows only (help_articles.state). Only a guide that is still a draft and that nobody has edited in Admin is published; a guide an administrator has touched is left as it is.
-- Run this on a database only when the Family workspace is open there (flags.family_workspace). Safe to run again. Rollback: supabase/rollback/family_guides_published.sql
-- One link is changed first: "give a question set" pointed to the Marketplace buying guide, which is still a draft, so that line becomes plain text (the same fix as in the 20 November corrections).
begin;

update public.help_articles
   set body = replace(body, '1. Buy a set in the [Marketplace](help:buy-a-question-set).', '1. Buy a set in the **Marketplace**.')
 where slug = 'family-question-library' and state = 'draft' and updated_by is null;

update public.help_articles
   set state = 'published', published_at = coalesce(published_at, now()), updated_at = now()
 where slug in ('family-workspace-start', 'add-a-child', 'link-an-existing-student', 'child-workspace-link', 'give-work-to-children', 'pay-for-children', 'family-question-library', 'family-challenges')
   and state = 'draft'
   and updated_by is null;

commit;
