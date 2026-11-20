-- Publish a parent-facing guide for the Family workspace: how a parent or guardian signs up as a sponsor, creates the family,
-- adds or links a child, and what they can do there. Rows only; the feature itself stays behind flags.family_workspace.
-- Audience is sponsor: parents sign up as sponsors, so the guide sits in the Sponsors tab of the Help centre.
-- Safe to run again (on conflict do nothing). Rollback: supabase/rollback/parent_family_help.sql
begin;

insert into public.help_articles(slug, title, summary, body, category, audiences, sort_order, state, published_at)
values (
  'parents-and-family-workspace',
  'Parents and guardians: create your family workspace',
  'Create a private Family workspace, add your child or link their existing QuizBox account, and see what you can do together.',
  $g$
# Parents and guardians: create your family workspace

Your Family workspace brings your children's QuizBox learning together in one private place. You can add a child, or link a child who already has a QuizBox account. Each child keeps their own student account and can still join their school class.

## Before you start

- You need your own adult QuizBox account. Children do not sign up for themselves as parents.
- Sign up as a **sponsor**. Choose **Sponsor, parent or organization** in the role list. On the next screen, choose **Myself, a parent or guardian** (or **An organization** if you sign up for one), then enter your name and email. Your sponsor account is the one you use for your children.
- If **Family** is not in your menu, the Family workspace is not open for your account yet. Support can tell you when it is.

## Create your family

1. Sign in, open **Family** in the menu and choose **Family workspace**. The first time you open it, QuizBox sets up your workspace for you.
2. To make an account for a child, press **+ Add child**. Enter their first name, age and grade.
3. Tick the box to confirm that you are the child's parent or guardian and that you agree to set up their account. Then press **Add child**.
4. Copy the workspace link shown for your child and send it to them. They open the link, choose their own password and sign in with the username you can see on the page. The link works once. If it has expired or has been used, open that child's page in your Family workspace to get a new one.

## Link a child who already uses QuizBox

1. In your Family workspace, press **Link an existing student**.
2. Enter the email address your child uses on QuizBox and send the request.
3. Your child sees the request on their Home page and must accept it. Until they do, you cannot see their progress or give them work. QuizBox does not say whether an account exists for that email.

## What you can do in the workspace

- See each linked child's completed work, their average for the month and the work still to do.
- Give children approved practice work and follow their results.
- Give them question sets you bought in the Marketplace, or invite them to challenges you choose.
- Buy Coins or a subscription for one child or several children in one checkout. Each child gets their own Coins or subscription.

## Support a student who is not your child

As a sponsor you can link to any student by email with **Link an existing student**. A sponsor link lets you see their progress and buy Coins or a subscription. It does not let you give them work.

- The student accepts the request. For a child whose account a school or parent manages, or a child under 13, their parent or guardian accepts it first. If no guardian is linked, QuizBox staff decide.
- Alumni and old students' associations take part in a school's competitions by invitation. To support selected students through a family, apply for approval from your Family workspace. QuizBox staff or the school's administrator decide.

## Privacy and access

- You only see children linked to your family.
- If you remove a child from your family, your link ends. Their QuizBox account, school and results stay the same.
- Children under 13 have extra protection: no chat and no public leaderboards. They cannot pay online, so you arrange their Coins or subscriptions from your Family workspace.

Need help? [Contact support](/contact).
$g$,
  'account', array['sponsor']::text[], 58, 'published', now()
)
on conflict (slug) do nothing;

commit;
