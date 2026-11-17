-- Help centre refresh, 16 Nov 2026: guides brought in line with the features that shipped since the first guides.
-- Three guides are refreshed (sign-up and class level, the teacher menu, the five-step assignment). A refresh only applies to a guide that no administrator has edited (updated_by is null),
-- so an edit made in Admin, Help guides is never overwritten. Thirteen guides are new: a way-round guide for everyone, subjects, the school card, work from school and family, assign by topic,
-- and the family workspace (flag-gated, drafts until the feature is switched on). Drafts are not shown to anyone until an administrator publishes them.
-- Inserts skip any slug already present, so applying this again is safe. Rollback: supabase/rollback/help_guides_refresh.sql (removes only the new guides that nobody has edited).


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
