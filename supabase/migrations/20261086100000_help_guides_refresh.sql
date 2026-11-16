-- Help centre refresh, 16 Nov 2026: guides brought in line with the features that shipped since the first guides.
-- Three guides are refreshed (sign-up and class level, the teacher menu, the five-step assignment). A refresh only applies to a guide that no administrator has edited (updated_by is null),
-- so an edit made in Admin, Help guides is never overwritten. Thirteen guides are new: a way-round guide for everyone, subjects, the school card, work from school and family, assign by topic,
-- and the family workspace (flag-gated, drafts until the feature is switched on). Drafts are not shown to anyone until an administrator publishes them.
-- Inserts skip any slug already present, so applying this again is safe. Rollback: supabase/rollback/help_guides_refresh.sql (removes only the new guides that nobody has edited).
begin;

update public.help_articles set title = 'Getting started as a learner', summary = 'Your first steps on QuizBox: sign up, choose your class, add your subjects and find your way around.', body = $g$
# Getting started as a learner

QuizBox helps you practise your school subjects, join challenges and competitions, and see how you are improving.

## Your first steps

1. Create your account and choose **Student** when you are asked.
2. Choose your education level and your class (grade), so you see questions for your level.
3. You arrive on **Home**. On **Home** you can add the subjects your school teaches (see [add your subjects](help:add-your-subjects)).
4. If you see the card **Set up your school**, find your school by region, district and name (see [set up your school](help:set-up-your-school)).

Not sure where something is? See [find your way around QuizBox](help:find-your-way-around).

## The menu

- **Home**: your next task, your subjects and the cards that matter today.
- **Practise**: short practice sets with instant feedback. See [how to start a practice session](help:practice-session).
- **Assignments**: work from your teacher or your family, and the place where you join a class with a code. See [how to join a class](help:join-a-class) and [your work from school and family](help:your-work-from-school-and-family).
- **Compete** and **Challenges**: quizzes you can join. See [how to join a challenge or competition](help:join-challenge-or-competition).
- **My challenges** and **Create and share**: your attempts, and quizzes you make for friends. See [how to create a challenge](help:create-a-challenge).
- Under **My learning**: **Progress** (your results and how well you know each topic), **Assessments**, **Marketplace** and **My question sets**. See [your results and progress](help:results-and-progress).
- Under **Me**: **Notifications**, **Unfinished work**, **Subscribe** and **Account**.

## Question sets and challenges from your family

If a parent or guardian gives you a question set or invites you to a challenge, it appears on **Home** under its own heading, with the name of the person who sent it.

## Free sessions

When you sign up, you get a small number of free practice sessions. When they are used, you need a plan to carry on. See [subscribe, Coins and paying](help:subscribe-and-coins).

If you are stuck, choose **Support** at the top of the page and [send us a request](help:contact-support).
$g$, updated_at = now()
where slug = 'getting-started-learner' and updated_by is null;

update public.help_articles set title = 'Getting started as a teacher', summary = 'Set up your first class, add learners, publish an assignment, and find your way around the teacher menu.', body = $g$
# Getting started as a teacher

QuizBox lets you set work from approved, curriculum-aligned questions and see how your learners do.

## What is in your menu

- **Dashboard** and **Unfinished work**: what needs you today, and the work you have not finished.
- **Classes**: create a class and give learners its code. See [how to create a class](help:create-a-class).
- **Young learners**: create sign-ins for learners under 13. See [how to add young learners](help:add-young-learners).
- **Assignments**: publish work to a class. See [how to create an assignment](help:create-an-assignment). To spread one test across several topics or subjects, use **Assign by topic** at the top of the page. See [assign by topic](help:assign-by-topic).
- **Gradebook**: see your learners' results.
- **Question Banks** and **Practise questions**: look through the questions and try them yourself. See [how to start a practice session](help:practice-session).
- Under **Explore**: **Challenges**, **Open to join**, **Competitions**, **Marketplace** and **Sell question sets**. See [how to create a challenge](help:create-a-challenge), [how to create a competition](help:create-a-competition) and [sell your question sets](help:sell-question-sets).

## Your school

If your school is not set up yet, you will see the card **Set up your school** on your home page. See [set up your school](help:set-up-your-school). You choose your school when you sign up as a teacher, and the school has to be filled in.

## If you are also a parent or guardian

You can open a **Family workspace** from the menu to add your children, give them work and follow their progress. See [open your family workspace](help:family-workspace-start).

## A good first week

1. Create your class.
2. Give learners the class code, or add young learners yourself.
3. Publish a short assignment on a topic you are teaching.
4. After your learners submit, open the **Gradebook**.

Stuck? Choose **Support** at the top of the page and [send us a request](help:contact-support).
$g$, updated_at = now()
where slug = 'getting-started-teacher' and updated_by is null;

update public.help_articles set title = 'Create an assignment', summary = 'Give your class a set of approved questions, step by step, and publish it.', body = $g$
# Create an assignment

An assignment is a set of questions from the approved QuizBox bank that you give to a class.

## Steps

1. Open **Assignments** in the menu.
2. **Class**: choose the class. Only learners who have joined it will see the work.
3. **Scope**: choose the curriculum objective the questions come from. Press **Use this objective**, or pick it from the list.
4. **Questions**: choose how many questions you want and how hard they should be (or leave it on **Mixed**). Choose whether the questions are picked **Automatic** or **Manual**.
5. **Configure**: give the assignment a **Title** and a description. Set the **Mode**, the number of **Attempts**, the **Time limit (minutes)** and the **Due date**.
6. **Review & publish**: check everything, then press **Publish assignment**. You will see that the assignment was published to enrolled learners.

Each step tells you what is missing before you can move on.

## Good to know

- Only learners who have joined the class see it. See [how to create a class](help:create-a-class).
- To share one test evenly across several topics or subjects, use **Assign by topic** at the top of the page. See [assign by topic](help:assign-by-topic).
- Learners do the work from **Assignments** and **Practise**. See [how learners do an assignment](help:do-an-assignment).
- After they submit, open the **Gradebook** to see the results.
$g$, updated_at = now()
where slug = 'create-an-assignment' and updated_by is null;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('find-your-way-around', 'Find your way around QuizBox', 'The top bar, the menu on the left, and where to find search, notifications, help and your account.', 'getting-started', array['everyone']::text[], 5, 'published', now(), $g$
# Find your way around QuizBox

Every signed-in page has the same places to look.

## The top bar

- **Search** (the magnifying glass): type a name or a word to find a page, a class or a guide.
- **Bell**: your notifications. A number on it means something is new. See [notifications](help:notifications).
- **Help**: the Help centre, with guides for each part of QuizBox.
- **Support**: send a request to our team when you are stuck. See [send us a request](help:contact-support).
- **Account**: your name, country, password and notification settings.
- **Sign out**: leaves QuizBox on this device.

## The menu on the left

The menu shows only what your account can use.

- **Learners** see Home, Practise, Assignments, Compete and Challenges, and under **My learning** their progress and the Marketplace.
- **Teachers** see their teaching pages (Classes, Assignments, Gradebook, Question Banks) and **Explore**.
- **School leaders** see the School area, with an overview of classes, teachers and learners.
- **Sponsors** see their dashboard, challenges and competitions.

On a phone, the menu is behind the **More** button.

## Stuck?

Try **Search** first, then the [Help centre](/help). If that does not answer your question, [send us a request](help:contact-support).
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('add-your-subjects', 'Add your subjects', 'Choose the subjects your school teaches, from your home page, after you sign up.', 'getting-started', array['student']::text[], 12, 'published', now(), $g$
# Add your subjects

You do not choose subjects when you sign up. You add them afterwards, from your home page. The card shows every subject for your education level, so you can pick the ones your school teaches.

## Steps

1. Open **Home**. The card **Add your subjects** shows the subjects for your education level.
2. Tick each subject your school teaches. Tick it again to remove it.
3. Press **Save my subjects**. The card then shows your subjects, with **Change** to update them later.

## Good to know

- Only the subjects for your education level are shown.
- Your subjects are saved on your profile.
- Changing your class level or your school is different: those changes are made in **Account**, and you can make two of them in six months.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('set-up-your-school', 'Set up your school', 'Find your school by region, district and name, so your teachers and classmates can find you.', 'getting-started', array['student','teacher']::text[], 14, 'draft', null, $g$
# Set up your school

The card **Set up your school** on your home page helps you find your school from a list. Choosing the region and district first means schools with similar names are not mixed up.

This card appears once QuizBox has opened its school list. If you cannot see it, the list is not open yet.

## Steps

1. On **Home**, find **Set up your school**.
2. Choose the type of school: **Public**, **Private** or **All schools**. Choose a level (Primary, JHS or SHS) if you want to narrow the list.
3. Choose your **Region**, then your **District**.
4. Type part of your school's name, and choose your school from the list.
5. The card shows **Your school is set**. You can change it later in **Account**.

## If your school is not on the list

1. Press **My school is not listed**.
2. Type your school's full name, tick the levels it teaches, choose Public or Private if you know, and press **Add my school**.
3. Your school is linked to you straight away. Our team checks new schools so that every name is spelt the same way for everyone.

## Good to know

- The card is hidden once your school is set.
- Teachers choose their school when they sign up, and can see this card if their school is not set.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('your-work-from-school-and-family', 'Your work from school and family', 'See who gave each piece of work, and filter your assignments to school or family work.', 'assignments', array['student']::text[], 33, 'published', now(), $g$
# Your work from school and family

Your work can come from your teacher at school, or from a parent or guardian who has a family workspace on QuizBox. Both appear in your **Assignments** list, and each one is labelled so you can tell them apart.

## What the labels mean

- **School**: work from your teacher, for one of your classes.
- **Family**: work a parent or guardian gave you.

## Steps

1. Open **Assignments** in the menu.
2. If you have family work, you will see three buttons above the list: **All**, **School** and **Family**. Each shows how many items it holds.
3. Press **Family** to see only the work from your family, or **School** for your classes.
4. Press **Start** on any item to begin it, as before.

## Good to know

- The same title can come from both sources. Each one is kept separate, so check the label before you start.
- Your results for every piece of work appear in **Progress**.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('assign-by-topic', 'Assign by topic', 'Give one test across several topics or subjects, with the questions spread evenly over the topics you taught.', 'assignments', array['teacher']::text[], 36, 'published', now(), $g$
# Assign by topic

Use **Assign by topic** when you want one test to cover several topics, or several subjects in a Primary or JHS class. QuizBox spreads the questions evenly over the topics you choose.

## Steps

1. Open **Assignments** and choose **Assign by topic** at the top of the page.
2. Choose the **class**.
3. Choose the subject. In a Primary or JHS class you can add more subjects to the same test. Each subject is a section with its own number of questions.
4. Tick the topics you taught, or choose **Any topic** to let QuizBox choose.
5. Set the number of questions for each section. The page shows the plan: how many questions each topic gets, and how they are split across easy, medium and hard.
6. Set the title, the mode, the number of attempts, the time limit and the due date.
7. Press **Publish**. Your learners see the test in **Assignments**.

## Good to know

- Only topics that are **open** appear. A topic opens once it has enough approved questions. If you cannot see a topic you expect, ask your administrator.
- If a topic cannot give its share of questions, the page names that topic and does not publish. Choose another topic, or ask for fewer questions. QuizBox does not move questions between topics without telling you.
- To give one simple assignment instead, use [create an assignment](help:create-an-assignment).
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('family-workspace-start', 'Open your family workspace', 'What the family workspace is, how to open it, and what you can do there for your children.', 'account', array['teacher','sponsor']::text[], 60, 'draft', null, $g$
# Open your family workspace

The family workspace is a private space for a parent, guardian or mentor to look after the children they support on QuizBox. Each child keeps their own QuizBox account. The family workspace can give them work, invite them to challenges and show you their progress, but only for the children who have linked to you.

The family workspace is shown in the menu under **Family** once it is open for your account.

## Steps

1. Open **Family** in the menu, then **Family workspace**.
2. The first time you open it, your workspace is made for you.
3. You see **My children**. Press **+ Add child** to make an account for a child, or **Link an existing student** to ask a child who already has an account.
4. Once you have children, the page shows a line for each child with the work done and the average this month. Press a child's name to see that child's page.

## What you can do

- [Add a child](help:add-a-child), or [link an existing student](help:link-an-existing-student).
- [Give work to your children](help:give-work-to-children).
- [Buy Coins and subscriptions for your children](help:pay-for-children).
- [Give practice sets you bought](help:family-question-library).
- [Invite your children to challenges](help:family-challenges).

## Good to know

- You only see and do what the link allows. A child you remove is no longer visible to you, and their account is unchanged.
- Your children's school work is not shown to you unless you are their teacher.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('add-a-child', 'Add a child to your family', 'Make a QuizBox account for your child and send them a link to choose their own password.', 'account', array['teacher','sponsor']::text[], 61, 'draft', null, $g$
# Add a child to your family

You can make a QuizBox account for your child yourself. Your child does not need to sign up. They choose their own password from a link you send them.

## Steps

1. Open **Family workspace** and press **+ Add child**.
2. Type the child's first name and last name. You can also type a display name, which is what other people see.
3. Enter the child's age and choose their education level and class. Only classes your country offers are shown.
4. Type the school if you know it. This is optional.
5. Tick the box to confirm that you are the child's parent or guardian and agree to set up their account.
6. Press **Add child**.
7. QuizBox shows the child's **workspace link** and their username. **Copy link**, or press **Send on WhatsApp**, and send it to your child.

## Good to know

- The link works **once**, and expires after seven days. Keep it private.
- The link is shown only once. If you lose it, open the child's page and press **Make a new workspace link**. A new link cancels the old one.
- If your child forgets their password, press **Reset access** on their page. Their old password stops working straight away, and you get a new link.
- Your child can read [how to open their family link](help:child-workspace-link) too.
- Children under 13 do not have chat or public leaderboards, and cannot pay online. You arrange their coins and subscriptions from your family workspace.
- **Remove [name] from my family** ends your link only. Their account, school and results stay the same.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('link-an-existing-student', 'Link an existing student', 'Ask a student who already has a QuizBox account to link to your family. Nothing is shared until they accept.', 'account', array['teacher','sponsor']::text[], 62, 'draft', null, $g$
# Link an existing student

If your child or a young person already has a QuizBox account, you can ask to link to it. You do not need to know anything else about their account.

## Steps

1. Open **Family workspace** and press **Link an existing student**.
2. Type the email address the student uses on QuizBox.
3. Press **Send request**.

The student sees your request the next time they open QuizBox. They can accept or decline it. You will see them in **My children** once they accept.

## Good to know

- QuizBox gives the same answer whether or not an account exists with that email, so nobody can find out who has an account this way.
- Until the student accepts, you see only the email address you typed, not their name or class.
- You can send up to ten requests in one day.
- Students who are under 13 and have accounts made by a teacher cannot be linked this way.
- You can remove a student at any time from their page.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('child-workspace-link', 'Open your family link', 'For students: open the link your parent sent, choose your password, and sign in. Answer a link request.', 'account', array['student']::text[], 63, 'draft', null, $g$
# Open your family link

Your parent or guardian may have made a QuizBox account for you. They send you a link to choose your password. You use the link once.

## Steps

1. Open the link your parent sent you.
2. Choose a password. Use at least six characters. Two short words work well, like "mango cat".
3. Type it again and press **Save my password**.
4. Go to www.quizbox.io, and sign in with the **username** your parent gave you and your new password.

## If the link does not work

- The link works only once. If it has been used, has expired, or was replaced by a newer one, ask your parent for a new link.
- Never share your password with anyone, including your friends.

## If someone asks to link to your account

When a parent or guardian asks to link to your account, a card called **Someone wants to link to your account** appears on your home page. Press **Accept** only if you know the person. Press **Decline** if you do not. Once you accept, they can see your progress and give you work.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('give-work-to-children', 'Give work to your children', 'Choose the children, the subject and the topics, then send one piece of practice work to each child.', 'assignments', array['teacher','sponsor']::text[], 64, 'draft', null, $g$
# Give work to your children

You can give practice work to the children in your family. It uses the same approved questions as a teacher's assignment, and each child sees it in their workspace, labelled **Family**.

## Steps

1. Open **Family workspace**, then **Give work** (or open a child's page and press **Give [name] work**).
2. Choose the class level if you have children in more than one.
3. Tick the children it is for. Press **Select all** to choose everyone in that level. Nothing is ticked by default.
4. Choose the subject, then tick the topics.
5. Set the number of questions. The page shows how many questions the topics you chose can supply.
6. Optionally give it a name, a due date, the number of tries, and the minutes allowed.
7. Press **Check the questions**, then **Send**.

Work you have given appears on the same page, with each child's status (not started, started or done) and their score.

## Good to know

- Children in different class levels get separate work, because the topics are different for each level.
- If the topics cannot supply that many questions, the page tells you. Choose more topics or fewer questions.
- You can only give work to children you are allowed to give work to. Your link sets this.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('pay-for-children', 'Buy Coins and subscriptions for your children', 'Pay once for the children you choose, with a plan or Coins for each one.', 'payments', array['teacher','sponsor']::text[], 65, 'draft', null, $g$
# Buy Coins and subscriptions for your children

You can buy Coins and subscriptions for one child, several children, or everyone in your family. Each child gets their own Coins or plan, and you pay once.

## Buy Coins

1. Open **Family workspace**, then **Coins and wallet**.
2. The balances show each child's Coins and plan.
3. Tick the children you are buying for. For each one, choose how many Coins. Press **Same amount for everyone** to set them all at once, then change any child you want to.
4. Check the summary, which shows each child's amount and the total.
5. Press **Pay**. You will go to the payment page.

## Buy a subscription

1. Open **Family workspace**, then **Subscriptions**.
2. Tick the children and choose a plan for each one. Children can be on different plans. **Same plan for everyone** is a shortcut.
3. Check the summary and press **Pay**.

## After you pay

- Your children's Coins or subscriptions are added once the payment is confirmed. The page **Payment received** shows what each child received.
- If the page says the payment is still being confirmed, wait a few minutes and check **Coins and wallet** or **Subscriptions** again. Nothing is lost.
- If a refund is made, the Coins and subscriptions are taken back.

## Good to know

- The smallest amount for one child is 5 Coins.
- Children under 13 cannot pay online. You arrange their Coins and subscriptions from your family workspace.
- Each child's subscription can be changed or stopped on its own.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('family-question-library', 'Give a question set to your children', 'Give a Marketplace question set you bought to the children you choose.', 'practise', array['teacher','sponsor']::text[], 66, 'draft', null, $g$
# Give a question set to your children

A question set you buy in the **Marketplace** can be given to children in your family. Nothing is copied: each child practises the original set for as long as your purchase lasts.

## Steps

1. Buy a set in the [Marketplace](help:buy-a-question-set).
2. Open **Family workspace**, then **Question library**.
3. Find the set. Press **Give to children**.
4. Tick the children it is for, then press **Give**.

Each child is told, and sees the set under **Question sets from your family** on their home page.

## Good to know

- You can take a set back from any child. Press the **×** next to their name.
- If your purchase runs out, or is refunded, the children lose access to the set at the same time.
- The page shows each child's best score on the set.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('family-challenges', 'Invite your children to a challenge', 'Invite the children you choose to a challenge you made, with its access code.', 'challenges', array['teacher','sponsor']::text[], 67, 'draft', null, $g$
# Invite your children to a challenge

Make your challenge the way you normally do, in **Create and share**. Then invite the children in your family to take part.

## Steps

1. Create and publish your challenge. See [how to create a challenge](help:create-a-challenge).
2. Open **Family workspace**, then **Challenges**.
3. Find your challenge and press **Invite children**.
4. Tick the children, then press **Invite**.

Each child sees the challenge under **Challenges from your family** on their home page. If the challenge is private, the access code is shown there too. They press **Play** and take part as usual.

## Good to know

- You can take an invitation back at any time, with the **×** next to the child's name.
- Children who are under 13 follow the same challenge rules as everyone else.
- Your challenge's results are on its page in **Create and share**.
$g$)
on conflict (slug) do nothing;

commit;
