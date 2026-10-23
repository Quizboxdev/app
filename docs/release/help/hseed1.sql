-- The first set of Help centre guides, written in plain language from the screens as they are today. They are published; edit, unpublish or add more in Admin, Help.
-- Guides for learners, teachers, schools and sponsors only: no administrator workflows. Inserted only if the slug is not there yet, so applying this again never overwrites an edit.
-- Rollback: supabase/rollback/help_centre.sql removes the whole Help centre; to remove only these guides, delete them in Admin, Help.

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('getting-started-learner', 'Getting started as a learner', 'Your first steps on QuizBox: the menu, practice, joining your class and your first challenge.', 'getting-started', array['student'], 10, 'published', now(), $body$# Getting started as a learner

QuizBox helps you practise your school subjects, join challenges and competitions, and see how you are improving.

## Your first steps

1. Create your account and choose **Student** when you are asked.
2. Choose your grade, so you see questions for your level.
3. You arrive on **Home**. The menu on the left is your map.

## The menu

- **Practise**: short practice sets with instant feedback. See [how to start a practice session](help:practice-session).
- **Assignments**: work from your teacher, and the place where you join a class with a code. See [how to join a class](help:join-a-class).
- **Compete** and **Challenges**: quizzes you can join. See [how to join a challenge or competition](help:join-challenge-or-competition).
- **My challenges** and **Create and share**: your attempts, and quizzes you make for friends. See [how to create a challenge](help:create-a-challenge).
- **Progress**: your results and how well you know each topic. See [your results and progress](help:results-and-progress).
- **Notifications**, **Unfinished work** and **Account** are under **Me**.

## Free sessions

When you sign up, you get a small number of free practice sessions. When they are used, you need a plan to carry on. See [subscribe, Coins and paying](help:subscribe-and-coins).

If you are stuck, choose **Support** at the top of the page and [send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('getting-started-teacher', 'Getting started as a teacher', 'Set up your first class, add learners, publish an assignment and read the results.', 'getting-started', array['teacher'], 10, 'published', now(), $body$# Getting started as a teacher

QuizBox lets you set work from approved, curriculum-aligned questions and see how your learners do.

## What is in your menu

- **Classes**: create a class and give learners its code. See [how to create a class](help:create-a-class).
- **Young learners**: create sign-ins for learners under 13. See [how to add young learners](help:add-young-learners).
- **Assignments**: publish work to a class. See [how to create an assignment](help:create-an-assignment).
- **Gradebook**: see your learners' results.
- **Question Banks** and **Practise questions**: look through the questions and try them yourself. See [how to start a practice session](help:practice-session).
- Under **Explore**: **Challenges**, where you also start competitions, and **Open to join** to see what is open. See [how to create a challenge](help:create-a-challenge) and [how to create a competition](help:create-a-competition).

## A good first week

1. Create your class.
2. Give learners the class code, or add young learners yourself.
3. Publish a short assignment on a topic you are teaching.
4. After your learners submit, open the **Gradebook**.

Stuck? Choose **Support** at the top of the page and [send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('getting-started-school', 'Getting started for schools', 'What the School area shows, and how your teachers and classes fit together.', 'getting-started', array['school'], 10, 'published', now(), $body$# Getting started for schools

The **School** area gives a school leader an overview of the classes, teachers and learners on QuizBox.

## What you will find

- **Overview**: a summary of how your school is using QuizBox.
- **Classes**: the classes your teachers have created.
- **Teachers**: the teachers in your school.
- **Learners**: the learners in your classes.
- **Performance**: how your classes are doing.

## How the work gets done

- Teachers create the classes and publish the work. See [how to create a class](help:create-a-class) and [how to create an assignment](help:create-an-assignment).
- Learners join with a class code. See [how to join a class](help:join-a-class).
- Children under 13 get sign-ins created by their teacher, with the school's consent. See [how to add young learners](help:add-young-learners).
- A subscription for children under 13 is arranged by the school or a parent, not by the child. See [subscribe, Coins and paying](help:subscribe-and-coins).

To bring your school onto QuizBox, use the school enquiry on the [contact page](/contact). If you need help, [send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('practice-session', 'Start a practice session', 'Practise a subject with instant feedback and see your results afterwards.', 'practise', array['student', 'teacher'], 20, 'published', now(), $body$# Start a practice session

Practice sessions are short sets of questions. You see straight away whether you were right, with an explanation.

## Steps

1. Open **Practise** in the menu.
2. Under **Jump back in** you will find shortcuts: a quick practice set, practice on your weaker topics, and a way to carry on a set you started.
3. Or, under **Choose a practice set**, pick a **Subject** and a **Difficulty**, then start the set you like.
4. Answer each question. After each one, read the explanation, even when you were right.
5. At the end you see your score. Your results are saved under **Progress**.

## Tips

- A little practice often works better than a long session once a week.
- Practise your weaker topics first.
- If you leave in the middle, you can carry on later from **Jump back in**.

## Free sessions

New learners get a few free sessions. When they are used, you are taken to the **Subscribe** page. See [subscribe, Coins and paying](help:subscribe-and-coins).

Teachers can try the questions themselves from **Practise questions** in the menu.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('join-a-class', 'Join a class with a class code', 'Use the code from your teacher to join your class and see your assignments.', 'classes', array['student'], 30, 'published', now(), $body$# Join a class with a class code

Your teacher gives you a class code. It looks like this: **QB7-X4T9**.

## Steps

1. Ask your teacher for the class code.
2. Open **Assignments** in the menu. The page is called **Classroom**.
3. Under **Join a class**, type the code. Capital letters are added for you.
4. Press **Join class**. You will see a message that you have joined, with the name of the class.

After you join, your teacher's assignments appear on the **Assignments** page.

## If it does not work

- If you see **That class code was not found**, check each letter and number. Look out for 0 (zero) and O, and for 1 (one) and I.
- A class code can stop working after a while. Ask your teacher for a new one.
- Still stuck? [Send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

