# Plan: policies as a managed section, acknowledgement, Help centre, support tickets, upload, refund tools

Requested by the owner on 2026-10-23. Sign-off on every document: **QuizBox Solutions, Ghana**. Decision recorded here so each phase can be built, tested and delivered on its own.

## Phase map

| Phase | What | State |
|---|---|---|
| 1 | Refund tools in Admin (find payment, credit duplicate as Coins, record outcome, case list) | Built, tested, applied by the owner 2026-10-23 |
| 2 | Policy section (a small CMS) and acknowledgement | Built, tested, applied by the owner 2026-10-23 (company details and version 1 drafts in place; publishing is the owner's step) |
| 3 | Support tickets, and the contact form with upload | Built, tested, applied by the owner 2026-10-23 |
| 4 | Help centre with search and guides | Built and tested (10 + 6 database tests, route and helper tests); needs the database change applied (`docs/release/APPLY_HELP.md`). Guides written from the code, to be walked through once by the owner or beta testers |
| 5 | Terms of Use, Privacy Notice, Cookie notice, Refund policy as version 1 in the CMS | Drafted as version 1 drafts (migration 20261037100000); the owner fills the company details, reads them and publishes. Lawyer review recommended |

## Phase 2: policies as a managed section (the CMS)

**Idea:** every legal document is a row of text that an owner edits in Admin, not a file in the code. Update it there and visitors see the new version at once.

- **Where:** Admin, new "Policies" tab (owner and super admin). A document has a name (Terms of Use, Privacy Notice, Refund Policy, Cookie Notice, Acceptable Use), a web address (`/terms`, `/privacy`, `/refunds`, `/cookies`), and versions.
- **Writing a version:** type or paste text (simple formatting: headings, lists, links), or **upload a document (Word, PDF or text)**. An upload is converted to text using the same extractor already used for challenge material, shown for review, and saved as text. The text is the source of truth, so the page is searchable, accessible and the same for every visitor.
- **Versions:** each save is a draft version with a "what changed" summary and an effective date. Publishing makes it live; older versions stay readable at `/terms/history`. A published version cannot be edited, only replaced by a new one (so we can always prove what a user accepted).
- **Company details as variables:** registered name, address, registration number, support email, data-protection contact and Data Protection Commission registration number are entered once in Admin, Company details. Policies use them as `{{company_name}}` and so on. **Publishing is blocked while any variable is empty**, so nothing goes live with a blank or invented fact.
- **Acknowledgement:** after sign-up, and again after sign-in whenever a new *required* version exists, the user sees a screen listing each required document with a link to read it and a single "I have read and accept" action. The system stores who, which document, which version, when, and a fingerprint of the text. A new version can be marked "requires re-acknowledgement" (material change) or "notice only" (small edit). Until accepted, the user can read the policies, sign out or contact support, nothing else.
- **Children under 13:** their accounts are created by a teacher or school. The teacher accepts on the child's behalf when creating the account (school or guardian responsibility), recorded the same way. The child never sees a legal gate.
- **Database:** `policy_documents`, `policy_versions` (text, summary, effective date, state, fingerprint), `policy_acceptances` (user, version, time), `company_details`. Row-level security on all; writes only through checked functions; public read of published versions only. Migration with rollback and paste commands, as always.
- **Pages:** `/terms`, `/privacy`, `/refunds`, `/cookies` render the published version with its version number and effective date. The Refund Policy page already live becomes version 1 in the CMS.

## Phase 3: support tickets and the contact form with upload

- **Contact form (public):** adds a file section: up to 3 files, 5 MB each, images or PDF only. Visitors cannot write to storage directly, so uploads go through a server route that checks type and size, scans the file signature (not just the name), rate-limits by address, and stores them in a private bucket. Files are never public; staff open them by a short-lived link.
- **Tickets:** the existing `support_tickets` table is extended with a subject, category (account, payment or refund, class and assignments, challenges, other), priority, assignee and a reference number; a `support_messages` thread and `support_files` list are added. Signed-in users get **My tickets** (create, reply, see status). Visitors get a reference by email.
- **Admin:** the Support page gains a queue, replies, status and assignment. New tickets and replies send an email through the existing mail service; the email says "you have a reply", never the content of a private message.
- **Refund requests** use category "Payment or refund" and link straight to the Refunds tool.
- **Data protection:** attachments are deleted with the ticket after the retention period set in the Privacy Notice; tickets about children are visible only to staff.

## Phase 4: Help centre

- **Where:** `/help` inside the app (all roles, signed in) and public `/help` for visitors, from the same articles. Admin workflow articles are **not** included.
- **Managed in Admin, Help:** an article has a title, a short summary, steps (simple text with numbered lists), categories, and **who it is for** (everyone, student, teacher, school, sponsor). Draft, preview, publish, reorder; each save keeps its history.
- **Simple and findable:** a search box at the top (full-text search over titles, summaries and steps, tolerant of small typos), category tiles, and "most read". Every article ends with "Was this helpful?" and **"Still stuck? Send a support ticket"**, which opens a ticket with the article already attached as context.
- **Orchestrated on the platform:** a small "?" on the main screens (Practise, Create and share, Classes, Assignments, Subscribe) opens the matching article. A first-time checklist on each home page points to the 3 or 4 guides for that role.
- **First set of articles** (drafted from the beta tester manual, rewritten for users): create a practice session; create a challenge; create a competition (rounds, passing, sharing); create an assignment; create a class and send the class code (the join code can expire); add young learners; join a class with a code; join a challenge or competition; read the material before a quiz; share a quiz link; unfinished work and drafts; subscribe, Coins and mobile-money payment; ask for a refund; reset your password; find your results and progress; notifications; who can see my information; contact support.
- **Accuracy rule:** every step is checked against the real screen in a test account before the article is published.

## Phase 5: the legal documents

Written in plain language, version 1, signed **QuizBox Solutions, Ghana**:

- **Terms of Use** (accounts, acceptable use, user content and licences, quizzes and prizes, payments and Coins, cancellation and refunds by reference, availability, liability, governing law Ghana).
- **Privacy Notice** (what is collected and why, lawful bases, children, sharing with processors: hosting and database, payment (Paystack), email, push; retention; security; your rights; international transfers; breach notice; complaints; contact).
- **Cookie and storage notice** (essential sign-in storage; analytics only if used).
- **Refund Policy** (already published; moves into the CMS).

**Standards the drafting is written to follow:** Ghana Data Protection Act, 2012 (Act 843) and registration with the Data Protection Commission; GDPR and UK GDPR principles for any visitor from Europe or the UK (lawful basis, rights, transfer safeguards); COPPA-style verifiable parental or school consent for under-13 users; PCI DSS scope kept minimal because card details are only ever entered on Paystack, never on QuizBox; WCAG 2.2 AA for every legal and help page. This is a drafting standard, not a certification, and it is not legal advice. **A lawyer qualified in Ghana should review the Terms and the Privacy Notice before launch to the public.**

## Facts needed from the owner (entered in Admin, Company details, not in chat if private)
1. Registered company name and registration number; registered office address.
2. Support email address and, if different, a data-protection contact; Data Protection Commission registration number (if registered).
3. Where the database and hosting are located (Supabase region, Vercel region) for the transfer section.
4. Whether analytics or advertising cookies are used.
5. How long to keep: support tickets and attachments, inactive accounts, quiz attempts.
6. Change of mind on an unused purchase: refundable inside 7 days or not.
