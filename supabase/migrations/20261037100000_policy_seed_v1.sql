-- Version 1 drafts of the Terms of Use, Privacy Notice, Cookie and Storage Notice and Refund Policy, written in plain language and signed by QuizBox Solutions, Ghana.
-- They are saved as DRAFTS in Admin, Policies. Nothing goes live until the owner reads them, fills in Company details and presses Publish (publishing is refused while a {{detail}} is empty).
-- Inserted only for a document that has no version yet, so applying this again never overwrites an edit. Not legal advice: have a lawyer qualified in Ghana review the Terms and the Privacy Notice before public launch.
-- Rollback: delete the draft versions from Admin, Policies (or supabase/rollback/policy_seed_v1.sql).
begin;

insert into public.policy_versions(document_id, version_no, summary, body)
select d.id, 1, 'Initial version', $body$# Terms of Use

These terms are an agreement between you and {{company_name}}, a company registered in {{country}} (registration number {{registration_number}}), whose registered office is at {{registered_address}}. We run QuizBox, a learning, practice and competition platform for school curricula. You can contact us at {{support_email}}.

By creating an account or using QuizBox you accept these terms and our [Privacy Notice](/privacy). If you do not accept them, please do not use QuizBox.

## 1. Who can use QuizBox

- Learners, teachers, schools, sponsors and organisations can use QuizBox.
- A child under 13 can only use QuizBox through an account created and managed by their teacher or school, or with the permission of a parent or guardian. Teachers and schools who create accounts for children confirm that they have the right to do so.
- If you are under 18, you confirm that a parent, guardian or teacher knows you are using QuizBox.
- You must give true information when you sign up and keep it up to date.

## 2. Your account

- Keep your password private. You are responsible for what happens on your account. Tell us at once at {{support_email}} if you think someone else has used it.
- One person, one account. Do not share your account or create several accounts to gain an advantage in a challenge or competition.
- Teacher-managed child accounts are looked after by the teacher who created them.

## 3. Using QuizBox fairly

You agree not to:

- break the law or help anyone else to do so;
- cheat, for example by using software to answer questions, sharing answers during a timed round, or using someone else's account;
- upload content that is unlawful, abusive, hateful, sexual or that you do not have the right to use;
- try to break, overload or get around the security of QuizBox, or collect its content in bulk by automated means;
- harass, mislead or impersonate other people.

We may remove content, end a challenge or competition, or suspend an account that breaks these rules.

## 4. Content you add

- Quizzes, questions, reading material, logos and other content you add stay yours. You must own them or have permission to use them, and you confirm this when you upload material.
- You give us a licence to store, show and process that content so that QuizBox can work. For a public challenge or competition, this includes showing it to the people you choose to share it with.
- Learners can create quizzes from QuizBox curriculum questions only. They cannot add their own questions, prizes or logos.
- If you think content on QuizBox infringes your rights, write to {{support_email}} with the details and we will look at it promptly.

## 5. Challenges, competitions and prizes

- A challenge is a timed quiz. A competition has rounds, and the best players go through to the next round.
- The person or organisation that creates a challenge or competition sets its rules, audience and any prizes, and is responsible for them. Unless a prize is clearly offered by {{company_name}}, we are not the provider of that prize.
- Scores are calculated by our servers. Our decision on a score, a ranking or whether someone cheated is final, subject to your legal rights.

## 6. Learning content

Our questions follow school curricula and are reviewed, but they are study aids. We do not promise that using QuizBox will give any particular exam result. If you find a mistake in a question, please tell us at {{support_email}}.

## 7. Payments, Coins and subscriptions

- Prices are shown in Ghana cedis (GHS). One Coin is worth GHS 1. You pay by mobile money or card through Paystack. We never see or store your full card or mobile-money details.
- A payment becomes Coins on your account. Coins pay for the subscription plan or quiz seats you choose. A plan starts when your payment is confirmed and lasts for the period shown.
- The smallest online payment is GHS 5.
- Children under 13 do not pay online. A parent, guardian or school arranges their subscription.
- Refunds, duplicate charges and payments that were not applied are handled under our [Refund Policy](/refunds). Coins that have already been used are not refunded.
- We may change prices. A change does not affect a plan you have already paid for.

## 8. Availability and changes

We work to keep QuizBox available, but we cannot promise that it will always be free of interruptions or errors. We may improve, change or stop features. If we stop a paid feature, we will tell you and deal fairly with what you have paid for.

## 9. Ending your use

You can stop using QuizBox at any time and ask us to close your account at {{support_email}}. We may suspend or close an account that breaks these terms or puts others at risk, and we will tell you why when we can.

## 10. Our responsibility

To the extent the law allows, QuizBox is provided "as is", and {{company_name}} is not responsible for losses that we could not reasonably have predicted, or for the content of challenges, competitions and prizes run by other people. Nothing in these terms limits any liability that cannot be limited by law, or your rights as a consumer. Where we are responsible to you, our total liability for a claim is limited to the amount you paid us in the 12 months before the claim.

## 11. Changes to these terms

We may update these terms. For a real change we will ask you to read and accept the new version the next time you sign in. For a small correction we will update the page and show the date. Earlier versions stay available on this page.

## 12. Law and disputes

These terms are governed by the laws of {{country}}. Please contact us first at {{support_email}} so we can try to put things right. Courts in {{country}} can decide any dispute we cannot settle, without affecting any right you have to go to a court in the place where you live.

Issued by {{company_name}}, {{country}}.
$body$
from public.policy_documents d where d.slug = 'terms' and not exists (select 1 from public.policy_versions v where v.document_id = d.id);

insert into public.policy_versions(document_id, version_no, summary, body)
select d.id, 1, 'Initial version', $body$# Privacy Notice

This notice explains what personal information {{company_name}} ("we", "QuizBox") collects, why, who we share it with, how long we keep it and what rights you have. We are registered in {{country}} (registration number {{registration_number}}), at {{registered_address}}. We are registered with the Data Protection Commission under number {{dpc_registration}}. Our contact for privacy questions is {{dpo_contact}}, or write to {{support_email}}.

We follow the Data Protection Act, 2012 (Act 843) of Ghana and apply the principles of the EU and UK General Data Protection Regulation to people in those places.

## 1. What we collect

- **Account details:** name, email address, role (learner, teacher, sponsor, school), grade or class, and the sign-in details you choose. For children whose teacher creates the account, we keep only a first name, a username generated by QuizBox and the class.
- **Learning information:** the practice and quiz answers you give, scores, time taken, progress and results, and the challenges and competitions you join.
- **Payments:** the payment reference, amount, date and method. Your card or mobile-money details are entered on Paystack and are never stored by QuizBox.
- **Support and messages:** what you send us through the contact form or a support request, including any files you attach.
- **Technical information:** device and browser type, error reports and security logs, and, if you allow it, a notification token so we can send reminders.

## 2. Why we use it

- To give you QuizBox: to run your account, mark your work, show your progress, and run challenges and competitions (contract).
- To keep QuizBox safe and working: security, fraud and abuse prevention, fixing errors and improving the service (our legitimate interests).
- To take payments and keep the records the law requires (contract and legal obligation).
- To send reminders, notices about your account and, only if you agree, other messages (consent for optional messages).
- To answer your questions and requests (legitimate interests and legal obligation).

We do not sell personal information. Sponsors can offer quizzes, which we show to learners clearly marked as sponsored. Sponsors do not receive learners' personal information, except the names and scores of the people who take part in their own challenge or competition.

## 3. Children

- A child under 13 can only have an account created by a teacher or school, or with a parent or guardian's permission. The teacher or school confirms that they have the right to create the account.
- For these accounts we collect as little as possible, and QuizBox has no private chat between users.
- A parent or guardian can ask us, directly or through the school, to show, correct or delete a child's information. Write to {{support_email}}.

## 4. Who we share it with

- **Teachers and schools** see the results of the learners in their classes. **Organisers** of a challenge or competition see the names and scores of the people who take part.
- **Public leaderboards** show your first name and the first letter of your last name (for example "Kofi M."), with your score and time.
- **Service providers who process information for us:** our database, sign-in and file storage provider (Supabase), our hosting provider (Vercel), our payment provider (Paystack), and our email and notification services. They may only use the information to provide their service to us.
- **Authorities,** where the law requires it or to protect people from harm.

## 5. Where your information is stored

Our systems are hosted in {{data_location}}. When information is sent outside {{country}}, we make sure it is protected by suitable safeguards, such as contract terms that require the same level of protection.

## 6. How long we keep it

- Support requests and their files: {{retention_tickets}}.
- Inactive accounts: {{retention_inactive}}.
- Quiz attempts and results: {{retention_attempts}}.
- Payment records: for as long as the law requires.
- Unfinished work saved as a draft is deleted 24 hours after you last changed it.

When we no longer need information, we delete it or make it anonymous.

## 7. How we protect it

We use encryption in transit, access controls so that people only see what they are allowed to see, limited and logged staff access, and regular checks. No system is perfectly secure. If a breach puts your information at risk, we will tell the Data Protection Commission and the people affected as the law requires.

## 8. Your rights

You can ask us to:

- tell you what we hold about you and give you a copy;
- correct information that is wrong;
- delete your information, or restrict how we use it;
- stop using it where we rely on our legitimate interests;
- give it to you in a common format;
- stop optional messages, or withdraw consent you gave.

Write to {{support_email}}. We reply within 30 days. If you are not happy with our answer, you can complain to the Data Protection Commission in Ghana, or to the data protection authority in the place where you live.

## 9. Cookies and similar storage

We use storage on your device to keep you signed in and remember your choices. See our [Cookie and Storage Notice](/cookies).

## 10. Decisions made by computer

QuizBox marks quizzes automatically. We do not make decisions about you with legal or similarly significant effects by automated means alone.

## 11. Changes to this notice

If we change this notice in a real way, we will ask you to read and accept the new version. Earlier versions stay available on this page.

Issued by {{company_name}}, {{country}}.
$body$
from public.policy_documents d where d.slug = 'privacy' and not exists (select 1 from public.policy_versions v where v.document_id = d.id);

insert into public.policy_versions(document_id, version_no, summary, body)
select d.id, 1, 'Initial version', $body$# Cookie and Storage Notice

QuizBox uses small pieces of storage on your device so that the service works. This notice explains what they are. It belongs with our [Privacy Notice](/privacy).

## What we use

- **Sign-in:** keeps you signed in while you use QuizBox and protects your account. Without it you could not use the service.
- **Your choices:** remembers things such as filters and settings so you do not have to set them each time.
- **Unfinished work:** keeps a copy of what you were typing, so you can finish later. It is deleted 24 hours after your last change.
- **Notifications:** if you allow reminders on your phone or browser, a notification service worker receives them.
- **Page performance:** we measure how quickly pages load and where errors happen, in a way that does not follow you across other websites.

## What we do not use

We do not use advertising cookies, and we do not sell information about what you do on QuizBox.

## Your choices

You can clear storage or block cookies in your browser settings. If you block the sign-in storage, you will not be able to sign in. You can turn notifications off in your browser or phone settings at any time.

## Questions

Write to {{support_email}}.

Issued by {{company_name}}, {{country}}.
$body$
from public.policy_documents d where d.slug = 'cookies' and not exists (select 1 from public.policy_versions v where v.document_id = d.id);

insert into public.policy_versions(document_id, version_no, summary, body)
select d.id, 1, 'Initial version', $body$# Refund Policy

This policy explains what happens if you are charged twice, or a payment does not reach your account. It belongs with our [Terms of Use](/terms).

## How your payment works

QuizBox is run by {{company_name}}, {{country}}. Payments are made in Ghana cedis (GHS) through Paystack, by mobile money or card. One Coin is worth GHS 1. Your payment becomes Coins on your account, and the Coins are used for the plan or quiz seats you chose. Paystack sends you a receipt.

## The 7-day window

Ask for help within **7 days** of the payment. After 7 days we cannot reverse a payment.

## If you were charged more than once

If the same purchase was charged more than one time, we add the extra amount to your account as **Coins**. The extra is not paid back in cash. For example, if you paid GHS 10 twice for one plan, the second GHS 10 is added to your account as 10 Coins.

To check a duplicate we need evidence that the extra charge was not applied to your account: the Paystack receipt or reference for each charge, and a screenshot or statement from your mobile-money or bank account showing both charges.

## If you paid but nothing was added to your account

First we apply the payment to your account. If we cannot apply it, we refund it in cash to the way you paid, but **only if none of the Coins from that purchase have been used**. We check this in your account activity log. Coins that have already been used are not refunded.

## How to ask

1. Open the [contact page](/contact) and choose **Payment or refund** as the enquiry type.
2. Give the email on your QuizBox account, the Paystack reference, the date and the amount, and what went wrong.
3. For a duplicate charge, include the evidence described above. If you need to send a screenshot or statement, we will tell you how when we reply.

We decide within **3 working days** and tell you by email. If a cash refund is approved, it is sent through Paystack to the way you paid. How long it takes to reach you depends on your bank or mobile-money provider.

## Children's accounts

Children under 13 do not pay online. A parent, guardian or school arranges the subscription and can ask for help in the same way.

Questions? Write to {{support_email}}.

Issued by {{company_name}}, {{country}}.
$body$
from public.policy_documents d where d.slug = 'refunds' and not exists (select 1 from public.policy_versions v where v.document_id = d.id);

commit;
