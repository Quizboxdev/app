# Accounts for children under 13: design and decisions

Status: built 19 October 2026. The decisions below were taken by the owner's delegate so work could proceed; they are for review and are **not legal advice**. Have counsel confirm them against Ghana's Data Protection Act, 2012 (Act 843) and the Data Protection Commission's guidance before young learners go live.

## The rule
Children under 13 do not register themselves. A **teacher creates the account** for each learner in a class the teacher owns. The teacher must confirm that the school holds a parent or guardian's consent, and say where that consent is recorded. Learners over 13 keep registering themselves as before.

## What is collected, and what is not
| Collected | Never collected |
|---|---|
| First name (letters, spaces, hyphens, apostrophes only) | Email address, phone number |
| Class, grade and school (from the teacher's class) | Surname, photo, date of birth, location |
| A generated username and a generated password (stored only as the sign-in provider's hash) | Free-text profile fields |
| Learning activity: answers, scores, progress | Anything shared with sponsors or the public |

The child's sign-in address is `username@learners.quizbox.io`. Nothing is ever sent to it; it exists only because the sign-in system identifies accounts by address. The sign-in screen accepts a bare username and adds the domain.

## Sign-in credentials
- Username: first name (up to 12 letters, accents removed) plus 4 random characters, for example `ama.k7f2`.
- Password: 8 random characters in two groups, for example `k7mx-p2qa`, from an alphabet without look-alike characters (no 0, o, 1, l, i). About 40 bits; sign-in attempts are rate limited by the platform.
- The password is shown to the teacher **once**, on a printable card. QuizBox cannot show it again. A lost password is replaced by the teacher (Reset password), who gets a new card.

## Consent
- The teacher ticks a confirmation and types where the consent is recorded (at least 5 characters). That text is stored with the learner's consent record as `school-attested: ...`, with who confirmed it and when.
- QuizBox does not collect or hold the consent form itself: the **school is the keeper of the evidence** and must produce it if asked.
- If a guardian withdraws consent, the teacher uses **End account**. Sign-in is blocked at once; the account and class seat become inactive.

## What a managed child cannot do
Managed learners are blocked from these features whatever their consent status: chat, public leaderboards with real names, sponsored prizes, paid challenges, public discoverability (setting `safety.managed_minor_blocked_features`, editable by the owner). They cannot pay online: checkout refuses them and the Subscribe page tells them to ask their teacher or a parent. Practising, assignments, results and progress work as for any learner.

## Who can do what
| Action | Who |
|---|---|
| Create, reset, end a managed account | The teacher who owns the class (reset and end also for the teacher who created the learner) |
| See the roster of managed learners | The class's teacher, and platform admins |
| Anything else about a managed child | Nobody beyond what an ordinary learner's data already allows (own results, their teacher's class views) |

Every creation, reset and end is written to the audit log with the teacher's id. Creation is limited to 200 accounts an hour per teacher and resets to 60 an hour.

## Retention and deletion (proposed; counsel to confirm)
- Active accounts: kept while the school uses QuizBox.
- Ended accounts: personal data (name, username) removed after **12 months**; learning records kept only in a form that cannot identify the child.
- On a written request from a guardian or the school, the owner deletes the account and its personal data within **30 days**. (A deletion tool for the owner is not built yet; until it is, support handles requests by hand through the Enquiry Inbox.)

## Known limits and open items
1. Counsel must confirm: the consent model (school-attested), the retention periods, the privacy notice wording and the breach-notification duty.
2. The retention clean-up (anonymising ended accounts after 12 months) is not automated yet.
3. A school-wide view of managed learners across classes is not built; the roster is per class.
4. Siblings or families cannot be linked to a managed learner yet; parent access is through the school.
5. A teacher who leaves a school: their learners stay in the class; reassigning the class to another teacher also needs reassigning `managed_by`. Handle through support until a tool exists.
6. Not yet exercised end to end on production: create a test class and a test learner, sign in as the child, practise, then reset and end the account.

## Files
`supabase/migrations/20261019150000_managed_learners.sql` (rollback `supabase/rollback/managed_learners.sql`), `app/api/teacher/learners/*`, `app/(app)/teacher/learners/page.tsx`, `lib/managed/*`.
