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
