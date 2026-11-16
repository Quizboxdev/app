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
