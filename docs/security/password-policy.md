# Password policy

Decided by the owner on 2026-10-09. Most QuizBox users are learners aged 8 to 18, who struggled with the previous rules (8+ characters plus Supabase leaked-password protection).

## Policy

| Control | Setting | Where |
|---|---|---|
| Minimum length | 6 characters | Supabase Auth › Email › Minimum password length, and `PASSWORD_MIN_LENGTH` in `lib/password-policy.ts` |
| Character rules | None. Length matters more than complexity (NIST SP 800-63B). | Supabase › Password requirements: "No required characters" |
| Leaked-password protection (HaveIBeenPwned) | **Off**, as an accepted risk | Supabase › Prevent use of leaked passwords |
| Easy-to-guess passwords | Refused by the app: a short common list (`123456`, `password`, `qwerty`, `ghana123`, `quizbox`…), one repeated character, and straight runs (`654321`, `abcdef`) | `isEasyToGuess()` in `lib/password-policy.ts`, used on sign-up and password reset |
| Help for learners | Plain-language hints, show/hide, and **Suggest a password for me** (two familiar words and a number, e.g. `green-mango-47`) | `app/login/LoginForm.tsx`, `app/auth/update-password` |

## Accepted risk

With leaked-password protection off, Supabase accepts any password of 6 or more characters. The app-side check is the compensating control. It runs in the browser only, so a direct call to the Auth API bypasses it. To enforce it on the server, add a Supabase Auth password-verification hook that calls the same rules.

Sign-in is unaffected. Accounts that already have a password keep it.

## Release gate

The `password_policy` gate (`lib/operations/release.ts`) replaces `leaked_password_protection`. It passes when a fresh Management API read of the Auth configuration shows a minimum length of at least `PASSWORD_MIN_LENGTH`, checked by `authConfigMeetsPolicy()`, and it records which mode is in force. `security:readiness` reports leaked-password protection as P2 ACCEPTED RISK.

## Revisit when

- Teacher-managed learner accounts exist (no email, teacher resets). Younger learners would then not set their own passwords at all.
- Prize competitions open to the public, where a guessed password has real value.
