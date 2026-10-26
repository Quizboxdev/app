# Partner single sign-on (OpenID Connect)

QuizBox supports **OpenID Connect, authorization code flow with PKCE**. SAML is not supported in this release (decided by the owner). Your people sign in at your identity provider (Google Workspace, Microsoft Entra ID, Okta, Keycloak and so on). QuizBox never sees their password there.

## What the partner needs to provide
1. An OIDC application ("client") with **Authorization Code + PKCE (S256)**.
2. **Redirect URI** (register exactly this): `https://www.quizbox.io/api/partner/v1/sso/callback`
3. Scopes `openid email profile`.
4. Give QuizBox staff: the **issuer** (https), **client ID**, **authorization endpoint**, **token endpoint**, **JWKS (signing keys) address**, an optional **client secret**, and the **e-mail domain(s)** your organisation owns (for example `school.edu.gh`). Public mail domains such as gmail.com are refused.
5. ID tokens signed **RS256 or ES256**. HMAC and `none` are refused.
6. In the ID token: `sub` (a stable id, the same as the `external_ref` you allocate seats with, or send `qb_member_ref`), `email` and `email_verified: true`. For automatic learner accounts also send `grade` (a QuizBox grade such as `JHS1`).

## What QuizBox staff do (Admin > Partner Integrations > partner > Sign-in setup)
Verify the partner (with evidence), choose an address name (the sign-in page becomes `/partner/<name>`), enter the values above, save as **draft**, then **Save and activate**. Test with a real account on **Preview** first. The gateway flag stays off in production until the owner switches it on.

## How a sign-in is checked
QuizBox verifies: state (CSRF) and a signed cookie; PKCE; the signature against your published keys; issuer; audience (and authorized party); expiry (60 seconds of clock skew); issue time; the nonce QuizBox generated; and a non-empty subject. Only then does it look for an account:
1. an existing link between your issuer + `sub` and a QuizBox account; otherwise
2. one QuizBox learner or teacher account whose e-mail is `email_verified` and inside your approved domain (administrators and anyone with staff capabilities are never matched this way); otherwise
3. if staff enabled it: a new **learner** account (verified address in your domain and a `grade`); never a staff role; otherwise
4. the person is told to ask your organisation for an invitation.

The person then receives a normal QuizBox session through a single-use sign-in link, so their learning history, profile and permissions work as for any QuizBox user. A partner claim can never grant a privileged role.

## Licence effect
Sign-in links the person to their seat. Learner practice access comes from an **active seat on an active contract**. If the contract ends or the seat is revoked the person keeps their account and history; they simply fall back to the free allowance or any subscription they hold. Minors can be seated only when a school manages the account.

## Troubleshooting
| Message shown | Cause |
|---|---|
| `OIDC_AUDIENCE_MISMATCH`, `OIDC_ISSUER_MISMATCH` | Client ID or issuer in QuizBox differs from the token |
| `OIDC_SIGNATURE_INVALID`, `OIDC_KEY_NOT_FOUND` | Wrong JWKS address, or the token uses a key id not in the set, or an algorithm other than RS256/ES256 |
| `OIDC_NONCE_MISMATCH` | The provider did not return the nonce; enable nonce support |
| `OIDC_TOKEN_EXPIRED` | Check the provider's and QuizBox's clocks |
| `PARTNER_ACCOUNT_NOT_FOUND` | No account matched; invite the person or enable learner provisioning (needs `grade`) |
| `PARTNER_MEMBER_REVOKED` | The seat was revoked |
