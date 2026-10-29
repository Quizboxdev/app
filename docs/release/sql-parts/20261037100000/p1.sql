-- Version 1 drafts of the Terms of Use, Privacy Notice, Cookie and Storage Notice and Refund Policy, written in plain language and signed by QuizBox Solutions, Ghana.
-- They are saved as DRAFTS in Admin, Policies. Nothing goes live until the owner reads them, fills in Company details and presses Publish (publishing is refused while a {{detail}} is empty).
-- Inserted only for a document that has no version yet, so applying this again never overwrites an edit. Not legal advice: have a lawyer qualified in Ghana review the Terms and the Privacy Notice before public launch.
-- Rollback: delete the draft versions from Admin, Policies (or supabase/rollback/policy_seed_v1.sql).


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
