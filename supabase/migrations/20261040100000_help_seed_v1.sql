-- The first set of Help centre guides, written in plain language from the screens as they are today. They are published; edit, unpublish or add more in Admin, Help.
-- Guides for learners, teachers, schools and sponsors only: no administrator workflows. Inserted only if the slug is not there yet, so applying this again never overwrites an edit.
-- Rollback: supabase/rollback/help_centre.sql removes the whole Help centre; to remove only these guides, delete them in Admin, Help.
begin;

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

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('create-a-challenge', 'Create a challenge', 'Make a timed quiz in a few steps and share it with friends, a class or everyone.', 'challenges', array['student', 'teacher', 'sponsor'], 90, 'published', now(), $body$# Create a challenge

A challenge is one timed round. It is fast, simple and easy to share.

## Start

1. Open **Create and share** (learners) or **Challenges** (teachers and sponsors) in the menu. The page lists your quizzes.
2. Press **Start a challenge**. If it shows competitions, use the link **Go to challenges** first. A short guide takes you through the steps and shows a live preview of your quiz card.

## The steps

1. **The idea.** Give it a headline and one line that makes people want to join. Choose what it is about, how long it lasts, how many questions each player gets and how many tries each player has.
2. **The material** (teachers and sponsors). Add something to read, such as a story book, a policy or a product guide, so people can read it before they play.
3. **The audience.** Choose who can join: **Everyone**, **Anyone with the link** or **Only people with a code**. For a private quiz, set the access code. You can also choose who it is for and when it opens and closes.
4. **Your look** (teachers and sponsors). Add your name or organisation, a colour, a welcome message and a logo.
5. **Finish.** Your quiz is saved as a draft. Press **Add questions**.

## Add the questions and publish

- Open the **Questions** tab. Type your questions, paste them, or pick them from the QuizBox bank.
- Press **Publish** when you are ready. Then [share it](help:share-challenge-or-competition).

## If you are a learner

- You choose questions from the approved QuizBox curriculum bank, by subject and grade.
- Your quiz is shared by link or code. It is not listed publicly, and has no prizes, logo or reading material.

Your work is saved as you go, so you will not lose it if you leave. See [unfinished work](help:unfinished-work).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('create-a-competition', 'Create a competition with rounds', 'Run a competition where the best players go through to the next round.', 'challenges', array['student', 'teacher', 'sponsor'], 100, 'published', now(), $body$# Create a competition with rounds

A competition has several rounds. The best players go through to the next round until there is a winner.

## Start

1. Open **Create and share** (learners) or **Challenges** (teachers and sponsors) in the menu. The page lists your quizzes.
2. Press **Start a competition**. If the page shows challenges, use the link **Go to competitions** first. In the quiz guide, **Competition** is chosen as the kind of quiz.
3. Follow the steps to give it a headline, set the time, choose the audience and add your look. These are the same as in [how to create a challenge](help:create-a-challenge).

## Set up the rounds

1. Open the **Rounds** tab.
2. For each round, set its time and who goes through: a **pass mark** (the score a player needs), or the **top number** of players.
3. Add questions to each round in the **Questions** tab. The page shows how many questions each round still needs.

## Publish and share

Press **Publish**, then [share it](help:share-challenge-or-competition). Players see the rules for each round on the competition page. A player who does not pass a round is told they did not go through.

## Prizes and results (teachers and sponsors)

- Use the **Prizes** tab to list prizes, and the **Results** tab to follow how it is going.
- Learners can run competitions too, from approved QuizBox questions, shared by link or code, without prizes.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('share-challenge-or-competition', 'Share your challenge or competition', 'Send the link on WhatsApp or social media, or give out an access code.', 'challenges', array['student', 'teacher', 'sponsor'], 110, 'published', now(), $body$# Share your challenge or competition

You can share a quiz once it is published.

## Share it

1. Open your quiz from your list on **Create and share** (learners) or **Challenges** (teachers and sponsors).
2. Open the **Share** tab.
3. Choose how to send it: **WhatsApp**, **Facebook**, **X**, **Telegram**, **Copy link**, or your phone's own share menu.

## Who sees it

- **Everyone**: the quiz is listed on QuizBox for anyone to find.
- **Anyone with the link**: it is not listed. Only people you send the link to can find it.
- **Only people with a code**: people need the link and the access code you set. Good for a company, a class or a club.

## Good to know

- Everyone has to sign up before they join. The free sessions apply to them. That is how your quiz brings new people to QuizBox.
- Learners' quizzes are shared by link or code only.
- You can reuse a finished quiz: open it from the list of past quizzes and choose **Use as template**.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('read-the-material', 'Read the material before you play', 'Some quizzes come with a book, notes or a guide to read first. Here is how it works.', 'challenges', array['everyone'], 120, 'published', now(), $body$# Read the material before you play

Some challenges and competitions come with something to read, such as a story book, notes or a guide. The quiz card says **Reading included**.

## How to read it

1. Join the quiz. See [how to join a challenge or competition](help:join-challenge-or-competition).
2. Open the reading material from the quiz page.
3. Choose a chapter from the list. Use **A-** and **A+** to make the text smaller or larger.
4. Read, then start the quiz.

## When you can read

- You can read after you join.
- Reading is closed while a timed round is running, so nobody can look up answers.
- The organiser chooses whether reading closes when a competition opens or when it ends. The reader tells you when it will close.

## If you cannot open it

If the reader says you need to join first, join the quiz. If it says reading is closed, you have reached a time when it is not allowed. [Ask us for help](help:contact-support) if you think that is wrong.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('unfinished-work', 'Unfinished work and saved drafts', 'QuizBox saves what you are setting up, so you can finish it later.', 'challenges', array['everyone'], 130, 'published', now(), $body$# Unfinished work and saved drafts

If you leave in the middle of creating a challenge, a competition or a practice set, QuizBox saves what you typed.

## Find your drafts

Open **Unfinished work** in the menu. You will see each draft, when it was last saved and how long is left.

## How long drafts last

- A draft is deleted 24 hours after you last changed it. Any change starts the 24 hours again.
- No draft lasts longer than 72 hours from the first save.
- Two hours before it is deleted, you get a warning on the screen and in the bell, and by email when email is set up.
- Press **Keep 24 more hours** to give yourself more time.
- When you finish and publish, the draft is deleted at once.

We keep drafts for a short time only, so we do not hold data we do not need.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('subscribe-and-coins', 'Subscribe, Coins and paying', 'How plans, Coins and paying by mobile money or card work.', 'payments', array['student'], 140, 'published', now(), $body$# Subscribe, Coins and paying

## What a Coin is

One **Coin** is worth GHS 1. When you pay, your payment becomes Coins, and the Coins pay for the plan you choose.

## Plans

Open **Subscribe** under **Me** in the menu to see the plans and what they cost today. You are also taken there when your free sessions are used. Longer plans cost less for each day. The smallest online payment is GHS 5.

## How to pay

1. Open **Subscribe** and choose a plan.
2. Press **Pay with mobile money or card**. You go to Paystack, our payment partner, to pay. We never see or keep your card or mobile-money details.
3. After you pay, you come back to QuizBox. We confirm your payment, usually in under a minute, and your plan starts.

If the page still says it is waiting, do not pay again. Wait a minute and refresh. If your plan has not appeared, [send us a request](help:contact-support) with your Paystack reference.

## Children under 13

Children do not pay online. A school or a parent arranges their subscription. A teacher or parent can [ask us for help](help:contact-support).

## Something went wrong with a payment

- Charged twice, or paid but nothing was added? See [how to ask for a refund](help:ask-for-a-refund).
- A red message when you press Pay? It has a short **support code**. Please quote it when you [contact support](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('ask-for-a-refund', 'Ask for a refund or a duplicate charge', 'What we can refund, how to ask, and how long it takes.', 'payments', array['everyone'], 150, 'published', now(), $body$# Ask for a refund or a duplicate charge

Please ask within **7 days** of the payment. The full rules are in our [Refund Policy](/refunds).

## The short version

- **Charged more than once:** we add the extra amount to your account as Coins. It is not paid back in cash.
- **Paid but nothing was added:** we first apply the payment. If we cannot, and none of the Coins from that purchase were used, we refund it in cash.
- **Coins already used** are not refunded.

## How to ask

1. If you are signed in, open **Support**, then **Send a new request**, and choose **Payment, Coins or refund**. If you are not signed in, use the [contact page](/contact) and choose **Payment or refund**.
2. Tell us the email on your account, the Paystack reference, the date and the amount, and what went wrong.
3. Attach a screenshot or a statement that shows the charges. For a duplicate, show both charges.
4. We decide within 3 working days and reply by email.

Children under 13 do not pay online. A parent, guardian or school can ask on their behalf.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('reset-password', 'Reset a forgotten password', 'Get back into your account with a link sent to your email.', 'account', array['everyone'], 160, 'published', now(), $body$# Reset a forgotten password

## If you have an email address

1. On the sign-in page, choose **Forgot password?**.
2. Type the email address you signed up with and send the request.
3. Open the email from QuizBox and follow the link. Check your spam folder if you do not see it.
4. Choose a new password and sign in with it.

## If you are a child with a teacher-made sign-in

You use a username, not an email. Ask your teacher to reset your password. They will print you a new card.

## Still cannot get in?

[Send us a request](help:contact-support), or use the [contact page](/contact) if you cannot sign in at all. Please never send your password to anyone, including us.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('results-and-progress', 'Your results and progress', 'See how you are doing by subject and topic, and how a teacher reads the results.', 'practise', array['student', 'teacher'], 170, 'published', now(), $body$# Your results and progress

## Learners

1. Open **Progress** in the menu.
2. You will see how well you know each subject and topic, and your submitted results.
3. Open a result to see your answers and the explanations. Use it to decide what to practise next.

Your practice gets you closer to mastery of each topic. Practise your weaker topics first. See [how to start a practice session](help:practice-session).

## Teachers

1. Open **Gradebook** in the menu.
2. Choose the class and the assignment to see how each learner did.
3. Use the results to choose the next topic to teach, then [create another assignment](help:create-an-assignment).

You only see the learners in your own classes.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('notifications', 'Notifications and reminders', 'Where to see messages from QuizBox, and how phone reminders work.', 'account', array['everyone'], 180, 'published', now(), $body$# Notifications and reminders

## Where they appear

- The **bell** at the top of the page shows new notifications. Press it to open them.
- **Notifications** in the menu shows all of them. Press **Mark read** on one, or mark them all as read.
- You also get a message here when support replies to your request, and when a draft you were making is about to be deleted.

## Phone and browser reminders

If you allow reminders when QuizBox asks, you can get them on your phone or computer. You can turn them off at any time in your phone or browser settings.

Questions? [Send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('contact-support', 'Send a support request', 'How to ask us for help, attach a screenshot and follow the answer.', 'account', array['everyone'], 190, 'published', now(), $body$# Send a support request

If a guide did not solve your problem, ask us.

## When you are signed in

1. Choose **Support** at the top of the page.
2. Press **Send a new request**.
3. Choose what it is about, give it a short title and tell us what happened and what you expected.
4. Attach up to 3 files if it helps: a screenshot (PNG, JPEG or WebP) or a PDF, each up to 5 MB.
5. Press **Send request**. You get a reference, such as QB-T-1A2B3C4D5E.

Follow your request on the same **Support** page. When we reply, you get a notification and an email. You can reply there too. If a request is closed and you still need help, open a new one.

## When you cannot sign in

Use the [contact page](/contact). Fill in the form, attach a screenshot if you like, and we will reply by email. Keep the reference you are given.

## Tips for a quick answer

- Say what you were trying to do and what you saw instead.
- For a payment, include the Paystack reference, the date and the amount.
- Please never send your password. We will never ask for it.
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('sponsor-a-challenge', 'Run a sponsored challenge or competition', 'Create a branded quiz on your own material and reach the learners you choose.', 'challenges', array['sponsor'], 200, 'published', now(), $body$# Run a sponsored challenge or competition

As a sponsor you can make a quiz with your name, logo and colours, on material you supply, for the learners you want to reach.

## Steps

1. Open **Challenges** and start a challenge or a competition. See [how to create a challenge](help:create-a-challenge) and [how to create a competition](help:create-a-competition).
2. In **The material**, add what players should read first: a book, a policy or a product guide. Choose what kind of material it is, and choose which chapters players can read.
3. In **The audience**, choose who it is for, for example the levels you want to reach, and when it opens and closes.
4. In **Your look**, add your name or organisation, your logo, your colour and a welcome message.
5. Add the questions, then press **Publish**.

## After it is live

- Use the **Prizes** tab to list prizes, and the **Results** tab to follow how many people took part.
- Your quiz can appear as a **Sponsored** quiz for the audience you chose.
- [Share it](help:share-challenge-or-competition) on WhatsApp and social media.
- Sponsors do not receive learners' personal information, except the names and scores of the people who take part in their own quiz.

To ask about sponsorship, use the sponsor enquiry on the [contact page](/contact).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body) values ('staying-safe-and-private', 'Staying safe and keeping your information private', 'What other people can see, and how to keep your account safe.', 'safety', array['everyone'], 210, 'published', now(), $body$# Staying safe and keeping your information private

## What others can see

- On a **leaderboard**, people see your first name and the first letter of your last name, with your score and time.
- A teacher or school sees the results of the learners in their classes.
- The organiser of a quiz sees the names and scores of the people who take part in it.

## Keep your account safe

- Never share your password. QuizBox will never ask you for it.
- Sign out on a shared computer or phone.
- Use a password that is hard to guess.

## If you see something wrong

- Use **Report this challenge** on a quiz page if it is inappropriate, misleading or breaks someone's rights.
- [Send us a request](help:contact-support) about anything that worries you.

## More information

Read our [Privacy Notice](/privacy) and [Terms of Use](/terms). Children under 13 can only use QuizBox through an account made by their teacher or school, or with a parent's permission.
$body$) on conflict (slug) do nothing;

commit;
