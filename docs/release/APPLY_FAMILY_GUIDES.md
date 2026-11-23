# Family guides published as a set (migration 20261123110000)

What changes: the eight family guides stop being drafts and appear in Help (inside the app and on the website) and in search:
Open your family workspace, Add a child to your family, Link an existing student, Open your family link (for the child), Give work to your children, Buy Coins and subscriptions for your children, Give a question set to your children, Invite your children to a challenge.
A guide an administrator has edited in Admin is not touched. One line in "Give a question set" that pointed to the Marketplace buying guide (still a draft) becomes plain text.
Rows only; no table or function changes. The Family workspace itself stays behind `flags.family_workspace`.

## When
Apply it on a database only once the Family workspace is open there. On Preview that is now. On Production wait for the flag (the parents' promotion on the home page and the parent chip on the sponsor page are separate switches and stay as they are).

## Apply (after the pull request is merged)
First, in PowerShell, make sure the repo is up to date:
```
git -C C:\Users\USER\dev\codebase checkout main
```
```
git -C C:\Users\USER\dev\codebase pull
```
Preview (type the password, then the phrase):
```
C:\Users\USER\dev\fp\apply_one_migration.ps1 -Version 20261123110000 -Name family_guides_published -Target Preview -CheckSql "select (count(*) = 8)::int from public.help_articles where state = 'published' and slug in ('family-workspace-start','add-a-child','link-an-existing-student','child-workspace-link','give-work-to-children','pay-for-children','family-question-library','family-challenges')"
```
Production, later, the same command with `-Target Production`.

## Check
Open `/help/add-a-child` and `/help/family-workspace-start` on the site: both load, and the links between the family guides work. Search "link an existing student": it is found.

## Back out
```
C:\Users\USER\dev\fp\apply_one_migration.ps1 -Version 20261123110000 -Name family_guides_published -Target Preview -Rollback -CheckSql "select (count(*) = 8)::int from public.help_articles where state = 'published' and slug in ('family-workspace-start','add-a-child','link-an-existing-student','child-workspace-link','give-work-to-children','pay-for-children','family-question-library','family-challenges')"
```
The eight go back to draft (nothing is deleted).

## Linking the parent clips
Once these are published, the parent clips can be linked in Admin, Help videos (each clip can also stay on the parents' guide it is linked to now):
- REC-PARENT-01 Family workspace tour: Open your family workspace.
- REC-PARENT-02 Add a child form: Add a child to your family.
- REC-PARENT-03 Give work to a child: Give work to your children.
- REC-PARENT-04 Linked learner progress: Open your family workspace.
