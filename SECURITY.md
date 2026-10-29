# Security policy

QuizBox is used by school children, teachers and sponsors in Ghana, and it takes payments. We take reports of weaknesses seriously and want to hear about them.

## How to report a vulnerability

Use the contact form at **https://www.quizbox.io/contact**, choose "General enquiry", and start the message with **SECURITY**. Do not post details in a public issue or a public message.
Please include: where you found it, what you did, what you saw, and (if you can) the smallest example that shows it. Do not include real learners' personal data in your report.

> Owner to confirm before publishing widely: set up a dedicated mailbox (for example `security@quizbox.io`) and add it here. Until then the contact form is the channel.

## What to expect

- We aim to acknowledge a report within **3 working days** and to tell you what we found within **10 working days**.
- We will keep you informed, fix confirmed problems in order of risk, and say thank you publicly if you wish.
- Please give us reasonable time to fix a problem before telling anyone else.

## Please do not

- Access, change or delete other people's data, or use a weakness beyond what is needed to show it exists.
- Run tests that could slow the site down for others (floods, load tests, automated scanning at scale).
- Test payments with real money, or try to take over accounts that are not yours.
- Attack our staff, suppliers or other organisations.

## What is in scope

The website `www.quizbox.io` and its API routes, and the Supabase project behind it. Out of scope: reports that only list missing best-practice headers with no demonstrated effect, issues in third-party services (Paystack, Supabase, Vercel) that should go to them, and social engineering.

## Supported versions

Only the current `main` branch (what is live on www.quizbox.io) is supported.

## What we already do (so you do not need to report these)

Row-level security in the database; server-computed prices and a signature-checked payment webhook; constant-time secret comparison; upload size and zip-bomb limits; security headers (the Content Security Policy runs in report-only mode and is being enforced after a monitoring period); automated type checks, lint, tests and a dependency advisory check on every change. See `docs/DILIGENCE_OVERVIEW.md` for the full picture and the known open risks.
