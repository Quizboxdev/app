# Teacher profile editing

Migration `20261069100000_teacher_profile_edit.sql`. It ships **off**: the Edit button on a teacher's Account page stays hidden, and the database refuses the change, until the flag below is set to `true`. Apply to **Preview first**, check, then Production.

## What it does
- A signed-in teacher can change their **name, school, subjects and grades taught** on **Account, Teaching Profile, Edit profile**. Education levels follow the grades chosen.
- There is **no count limit** (learners have two edits in six months; a teacher's details change with their work). Every save is kept, with before and after, in a history table and in the audit log.
- A teacher who belongs to a **school's organisation** cannot change the school here: it follows the organisation, which the school administrator manages. The other fields still change.
- Country stays a reviewed request. A save that changes nothing is refused.
- Sponsors and SME reviewers are separate changes that reuse the same history table.

## Apply (Preview, then Production)
1. Supabase SQL editor, paste `docs/release/sql-parts/20261069100000/p1.sql`. Safe to run again.
2. Turn the flag on when ready (the owner runs this; Preview first):
```sql
update public.platform_settings set value = 'true'::jsonb where key = 'flags.teacher_profile_edit' and scope_type = 'global';
```
3. Check on Preview as the Preview teacher: Account, **Edit profile**, change the school and tick a subject, save. The page shows the new values. Check the history:
```sql
select kind, edited_at, before, after from public.account_profile_edits order by edited_at desc limit 5;
```

## Turn it off or undo
- Off: set the same setting to `'false'`. Details already changed stay.
- Undo: `supabase/rollback/teacher_profile_edit.sql` (drops the history table and the two functions, and removes the flag row).
