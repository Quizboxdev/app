# Help guides audit, 16 November 2026

What this covers: the in-app Help centre (the `help_articles` table, edited in Admin, Help guides). Admin-only screens are not in the Help centre by design (the seed says so); see the last section.

## What changed

Migration `20261086100000_help_guides_refresh.sql` (rows only, safe to run twice):

| Guide | Change |
|---|---|
| Getting started as a learner | Refreshed: sign-up asks for level and class, subjects are added on Home, the school card, question sets and challenges from family |
| Getting started as a teacher | Refreshed: Marketplace and Sell question sets in the Explore list, assign by topic, the school card, the family workspace for teachers who are parents |
| Create an assignment | Refreshed: the five real steps (Class, Scope, Questions, Configure, Review & publish) |
| Find your way around QuizBox | New, everyone, published: top bar, menu by role, phone More button |
| Add your subjects | New, learners, published (live now) |
| Your work from school and family | New, learners, published (the School and Family labels are live) |
| Assign by topic | New, teachers, published (live now) |
| Set up your school | New, learners and teachers, **draft**: publish when the school list is switched on |
| Family guides (open, add a child, link a student, child's link, give work, pay for children, question library, challenges) | New, **drafts**: publish one by one as each family feature is switched on |

A refresh only changes a guide that no administrator has edited (`updated_by is null`), so an edit made in Admin is never overwritten.

## Recent developments checked against the guides

| Development | Guide now | Status |
|---|---|---|
| Sign-up asks for level and class; subjects added after sign-up | Getting started (learner), Add your subjects | Updated |
| Set up your school card (flag-gated) | Set up your school | Draft until the school list is on |
| Five-step assignment wizard | Create an assignment | Updated |
| Assign by topic, multi-subject sections | Assign by topic | New |
| Student work labels and filter (School / Family) | Your work from school and family | New |
| Find your way (search, bell, help, support, account) | Find your way around QuizBox | New |
| Family workspace (open, add child, link, child link, give work, coins and subscriptions, library, challenges) | Family guides | Drafts until each feature is on |
| Managed children: subjects card message | Add your subjects (learner) | Message fixed in code; guide notes the teacher sets subjects for managed accounts |
| Password reset, sign-in with username | Reset a forgotten password, Add young learners | Checked, unchanged (still accurate) |
| Subscriptions and Coins | Subscribe, Coins and paying | Not changed yet: add the family line and any new plans (weekly, yearly) when Prices has them |
| Question sets and Marketplace | Buy a question set, Sell question sets | Not changed; the family library guide links to them |

## Still open

- **Not re-read against the screens in this pass:** the 26 guides that were not listed above. An intern should follow each on Preview and note any mismatch (the intern scenarios FEAT-108 cover this).
- **Google and Facebook sign-in:** not open to the public yet, so there is no guide. Add one when it is switched on.
- **Teachers' school and subjects at sign-up:** still asked at sign-up (the database needs a school for a teacher). The teacher guide says so; update it if that changes.
- **Admin screens:** the Help centre does not carry admin guides. The admin guides in `User Guides` (documents 04, 09 and 10) predate the school directory, social channels, families, affiliates and payment checks screens. Update them from the admin pages, not from memory.

## Found and fixed while checking

- A child whose teacher made the account could see the subjects card and then got a generic error on save. The message now says the teacher or parent sets their subjects for them.
