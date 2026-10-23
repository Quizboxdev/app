insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('create-a-class', 'Create a class and send the class code', 'Set up a class, copy its code and give it to your learners.', 'classes', array['teacher'], 40, 'published', now(), $body$# Create a class and send the class code

A class is a group of learners that you set work for.

## Create the class

1. Open **Classes** in the menu.
2. Under **Create class**, choose the curriculum level and grade for your class.
3. Type the **Class name**, the **Academic year** and the **Term**.
4. Press **Create class**. You will see: "Class created. Share its join code with learners."

## Send the class code

1. Under **Your classes**, find your class. Its **Join code** is shown on the line.
2. Press **Copy code**.
3. Send the code to your learners, for example on WhatsApp, or write it on the board.
4. Tell them to open **Assignments** and use **Join a class**. They can follow [how to join a class](help:join-a-class).

## Good to know

- Only learners with the code can join. Keep the code inside your class.
- A code can stop working after a while. If a learner says their code is not found, check the code in **Your classes** and send a fresh copy.
- Learners under 13 do not use a class code. You add them yourself. See [how to add young learners](help:add-young-learners).
- Next, [create an assignment](help:create-an-assignment).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('add-young-learners', 'Add young learners (under 13)', 'Create a username and password for each child in your class, print their sign-in cards and reset a password.', 'classes', array['teacher'], 50, 'published', now(), $body$# Add young learners (under 13)

Children under 13 do not need an email address. You create a sign-in for each child, and they use a username and a password.

## Create the sign-ins

1. Open **Young learners** in the menu.
2. Under **1. Choose the class**, pick the class.
3. Under **2. Add learners**, type the children's first names, one on each line. You can add up to 60 at a time.
4. Tick the box to confirm that your school has the consent it needs. Then write where that consent is recorded, for example "Class consent forms, term 1, kept in the school office".
5. Press the button to create the sign-ins.

## Give each child their card

1. Under **Sign-in cards**, each child has a username and a password.
2. Press **Print cards**, cut them out and give each child their card.
3. **The password is shown only once.** Print or write it down straight away.
4. Children sign in at www.quizbox.io with their username and password.

## If a child forgets their password

Find the child in **Learners in this class** and reset the password. A new password is made and shown once, so print the new card.

## Good to know

- Children's accounts stay inside their class. They do not pay online: a school or a parent arranges any subscription. See [subscribe, Coins and paying](help:subscribe-and-coins).
- Please read how we look after children's information in the [Privacy Notice](/privacy).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('create-an-assignment', 'Create an assignment', 'Publish a set of curriculum questions to a class, with a due date.', 'assignments', array['teacher'], 60, 'published', now(), $body$# Create an assignment

An assignment is a set of questions from the approved QuizBox bank that you give to a class.

## Steps

1. Open **Assignments** in the menu.
2. Choose the **Class**.
3. Choose the curriculum objective you want to test: press **Use this objective**, or pick it from the **Curriculum objective** list.
4. Choose how the questions are picked. **Automatic** picks them for you. **Manual** lets you choose each question. Set the **Difficulty** (or leave it on **Mixed**) and the number of **Questions**.
5. Give the assignment a **Title** and a **Description**.
6. Set the **Mode**, the number of **Attempts**, the **Time limit (minutes)** and the **Due date**.
7. On the last step, **Review and publish**, check everything and press **Publish assignment**. You will see "Assignment published to enrolled learners."

## Good to know

- Only learners who have joined the class see it. See [how to create a class](help:create-a-class).
- To share a topic evenly across several classes, use **Assign by topic** at the top of the page.
- Learners do the work from **Assignments** and **Practise**. See [how learners do an assignment](help:do-an-assignment).
- After they submit, open the **Gradebook** to see the results.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('do-an-assignment', 'Do an assignment from your teacher', 'Find your assignments, start one and see your result.', 'assignments', array['student'], 70, 'published', now(), $body$# Do an assignment from your teacher

## Find it

1. First [join your class](help:join-a-class) with the code from your teacher.
2. Open **Assignments** in the menu (the page is called **Classroom**). Your teacher's work for your classes is listed there. It also appears under **Jump back in** on **Practise**.

## Do it

1. Start the assignment.
2. Answer every question. Look at the **Time limit** and the **Due date**.
3. Submit when you are ready. Some assignments let you try more than once. The number of attempts is set by your teacher.

## Your result

Your result is saved under **Progress**, and your teacher can see it. See [your results and progress](help:results-and-progress).

If an assignment does not appear, check that you joined the right class, then [ask us for help](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('join-challenge-or-competition', 'Join a challenge or a competition', 'Find a quiz, join it, play it and see where you came on the leaderboard.', 'challenges', array['everyone'], 80, 'published', now(), $body$# Join a challenge or a competition

A **challenge** is one timed quiz. A **competition** has rounds: the best players go through to the next round until there is a winner.

## Find one

- Open **Challenges** or **Compete** in the menu, or use a link a friend sent you.
- Visitors can look at the public list on the QuizBox website. To play, you need a free account.

## Join and play

1. Open the quiz and press **Play now** (challenge) or **Join the competition**.
2. If the quiz is private, enter the **access code** you were given.
3. If the quiz has reading material, you can read it first. See [read the material before you play](help:read-the-material).
4. Answer the questions before the time runs out. Every answer is scored on our servers, so the leaderboard is fair.
5. At the end you see your score and the **Leaderboard**.

## Competition rounds

In a competition, finish the round with a good enough score to go through. The page for the competition shows the rules for each round, such as a pass mark or "the top 10 go through".

## Good to know

- Everyone has to sign up to join. Your first join uses one of your free sessions.
- Each quiz allows a number of tries per player.
- If you see something wrong or unsafe, use **Report this challenge** on its page.
$body$) on conflict (slug) do nothing;

