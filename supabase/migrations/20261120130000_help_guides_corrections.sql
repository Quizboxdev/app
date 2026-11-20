-- Help centre corrections from the 20 November 2026 guide audit. Rows only (help_articles.body).
-- Fixes: dead links to hidden drafts in the learner and teacher start guides, the family guides' claims about what a link to an existing child allows,
-- the sign-up wording for parents, the under-13 class-code line (owner decision AG-07), and where school leaders find the School area.
-- Each fix replaces one exact sentence. A guide an administrator edited in Admin (updated_by set) is never touched, and running it again changes nothing.
-- No guide is published or hidden here. Rollback: supabase/rollback/help_guides_corrections.sql
begin;

do $fix$
declare r record;
begin
  for r in select * from (values
    ('getting-started-learner', $a$find your school by region, district and name (see [set up your school](help:set-up-your-school)).$a$, $b$find your school by region, district and name, and follow the steps on the card.$b$),
    ('getting-started-teacher', $a$See [how to create a challenge](help:create-a-challenge), [how to create a competition](help:create-a-competition) and [sell your question sets](help:sell-question-sets).$a$, $b$See [how to create a challenge](help:create-a-challenge) and [how to create a competition](help:create-a-competition). The Marketplace and **Sell question sets** work once the Marketplace is open.$b$),
    ('getting-started-teacher', $a$you will see the card **Set up your school** on your home page. See [set up your school](help:set-up-your-school). You choose$a$, $b$you will see the card **Set up your school** on your home page. Follow the steps on the card. You choose$b$),
    ('getting-started-teacher', $a$You can open a **Family workspace** from the menu to add your children, give them work and follow their progress. See [open your family workspace](help:family-workspace-start).$a$, $b$When it is open for your account, **Family** appears in your menu. There you can add your children, give them work and follow their progress.$b$),
    ('find-your-way-around', $a$- **School leaders** see the School area, with an overview of classes, teachers and learners.$a$, $b$- **School leaders** open the **School** workspace from the workspace selector at the top of the page. It shows an overview of classes, teachers and learners.$b$),
    ('find-your-way-around', $a$- **Sponsors** see their dashboard, challenges and competitions.$a$, $b$- **Sponsors** see their dashboard, challenges and competitions, and parents and guardians also see **Family** when it is open for them.$b$),
    ('create-a-class', $a$- Learners under 13 do not use a class code. You add them yourself.$a$, $b$- Learners under 13 can join with a class code, or you can add them yourself.$b$),
    ('add-young-learners', $a$- Children's accounts stay inside their class. They do not pay online:$a$, $b$- A child's account belongs to the school. A parent can ask to be linked as a sponsor, with the guardian's approval. Children do not pay online:$b$),
    ('parents-and-family-workspace', $a$Sign up as a **sponsor**. Choose **Sponsor, parent or organization** in the role list. On the next screen, choose$a$, $b$Sign up as a **sponsor**. On the sign-up page, choose **Sponsor / organization**. After you confirm your email and sign in, the page **Set up your account** opens. There choose **Sponsor, parent or organization**, then choose$b$),
    ('parents-and-family-workspace', $a$Until they do, you cannot see their progress or give them work. QuizBox does not say$a$, $b$Until they do, you cannot see their progress. A link to an existing account lets you follow progress and buy Coins or a subscription, but you cannot give work. To give work, add the child with **Add child** instead. QuizBox does not say$b$),
    ('parents-and-family-workspace', $a$- Give children approved practice work and follow their results.$a$, $b$- Give approved practice work and follow results, for children you added with **Add child**.$b$),
    ('parents-and-family-workspace', $a$or invite them to challenges you choose.$a$, $b$or invite them to challenges you choose, again for children you added with **Add child**.$b$),
    ('parents-and-family-workspace', $a$- Children under 13 have extra protection: no chat and no public leaderboards. They cannot pay online,$a$, $b$- Children under 13 have extra protection. They cannot pay online,$b$),
    ('add-a-child', $a$- Children under 13 do not have chat or public leaderboards, and cannot pay online.$a$, $b$- Children under 13 cannot pay online.$b$),
    ('link-an-existing-student', $a$- Students who are under 13 and have accounts made by a teacher cannot be linked this way.$a$, $b$- A student under 13 whose account a teacher made can be linked this way too, but a guardian already linked to that child, or QuizBox staff, must approve it first.
- A link to an existing account lets you follow progress and buy Coins or a subscription. It does not let you give work. To give work, add the child with **Add child**.$b$),
    ('child-workspace-link', $a$Once you accept, they can see your progress and give you work.$a$, $b$Once you accept, they can see your progress and buy Coins or a subscription for you. They cannot give you work.$b$)
  ) as t(slug, old_text, new_text)
  loop
    update public.help_articles
       set body = replace(body, r.old_text, r.new_text), updated_at = now()
     where slug = r.slug and updated_by is null and position(r.old_text in body) > 0;
  end loop;
end
$fix$;

commit;
