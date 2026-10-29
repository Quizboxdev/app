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
