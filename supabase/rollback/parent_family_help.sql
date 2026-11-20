begin;

-- Removes only the parent guide, and only while nobody has edited it in Admin.
delete from public.help_articles
 where slug = 'parents-and-family-workspace'
   and updated_by is null;

commit;
