# Server-side sign-in guard (audit finding QB-AUD-006) — off until you switch it on

What it is: today a signed-out visitor who opens a signed-in page (for example /admin) is sent to the login screen by the page itself, in the browser. Your data was always protected by database rules, but the page shell was still sent. This adds a second line of defence: the **server** turns a signed-out request away before sending the page.

What it does when ON (`QB_SERVER_GUARD` = `on` in Vercel):
- Signed-in sections only (account, admin, competition, creator, drafts, guides, learn, marketplace, notifications, open, play, practise, review, school, seller, sponsor, student, subscribe, support, teacher). Public pages, the website, Help, pricing, challenge and competition public pages, login and sign-up, the API and the payment webhook are never touched.
- No sign-in cookie: sent to /login at once (a quiz link such as /play/some-quiz is remembered and returns after sign-in).
- A sign-in cookie: the server asks the sign-in service whether the session is real (this also refreshes an expiring session). Expired or forged: sent to /login.
- If the sign-in service cannot be reached, the request is allowed through (it fails open), so an outage never locks everyone out.
- Background page prefetches are not verified (they only warm the cache); the real visit is.

It is **OFF by default**. Nothing changes until you add the setting.

## Try it safely (Preview first)
1. Vercel, project `quizbox`, Settings, Environment Variables: add `QB_SERVER_GUARD` = `on`, **Preview only**. Redeploy a Preview (push any branch or redeploy the latest preview).
2. On that Preview URL: signed out, open `/admin`, `/student`, `/marketplace`, `/seller`: each should go straight to the login screen. Open `/pricing`, `/help`, `/challenges`: they open normally.
3. Sign in as a student, teacher and admin: every page you normally use opens, and moving between pages feels the same. Sign out: protected pages go to login again.
4. Check one quiz link: signed out, open `/play/<a-quiz-slug>`: you reach login, and after signing in you land on the quiz.
5. If all is well, add the same variable for **Production** and redeploy. To switch it off, delete the variable and redeploy.

Rollback is instant: remove `QB_SERVER_GUARD` (or set it to anything other than `on`) and redeploy.
