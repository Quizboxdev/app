# Apply and verify on Preview

Owner only. Preview project `fngdtxayfoiffbcbmcum`. **Do not run anything here against Production.**

## Migration record

| Order | Migration | Rollback (run in reverse order) | Applied to Preview | Applied to Production |
|---|---|---|---|---|
| 1 | `20261126100000_interschool_core` | `supabase/rollback/interschool_core.sql` | no | no |
| 2 | `20261126110000_interschool_registration` | `interschool_registration.sql` | no | no |
| 3 | `20261126120000_interschool_play` | `interschool_play.sql` | no | no |
| 4 | `20261126130000_interschool_billing` | `interschool_billing.sql` | no | no |
| 5 | `20261126140000_interschool_awards` | `interschool_awards.sql` | no | no |

Additive: one new schema, new functions, six settings and `institutions.verified_at` if missing. Re-running is safe. Rollback deletes all competition data. Paste-ready parts are in `docs/release/sql-parts/20261126*`.

## Steps

1. Preflight (read-only): `preview_apply_interschool.ps1 -PreflightOnly` (script in `dev\fp`).
2. Apply: `preview_apply_interschool.ps1`.
3. Push the branch so Vercel builds a Preview deployment.
4. Demonstration data, from a folder holding `.env.branch.local` and `.env.preview-db.local` (or set `QB_ENV_DIR`):
   `npx tsx scripts/interschool/demo-preview.ts --accounts C:\Users\USER\dev\fp\interschool-demo-accounts.txt --enable-flags`
   It creates 42 accounts, 4 schools, Basic 7 to 9 synthetic questions, a sponsored cup (2,000 participants × GHS 5 = GHS 10,000, payment recorded as pretend), a campaign link, an invited knockout and one finished round. About 7 minutes.
5. To turn the switches on without the demonstration: `preview_apply_interschool.ps1 -SwitchOn`.

## Environment

| Variable | Needed for |
|---|---|
| `PAYSTACK_SECRET_KEY` (test key) | paying an invoice online |
| `CRON_SECRET` | `/api/cron/interschool` reminders (call it by hand on Preview) |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` | public pages and links (already used by the app) |

## Checks on Preview (none done yet)

- [ ] With switches off: no Inter-school menu entry; home and competitions pages unchanged.
- [ ] Campaign page, flyer print, QR scan on a phone, WhatsApp message, link preview card.
- [ ] A learner registers from a campaign link; a teacher confirms and nominates.
- [ ] Wizard: create, set levels and rounds, preview, publish, pause, duplicate, cancel.
- [ ] Take a round on a phone; switch the network off and on; submit.
- [ ] Finalise, results for organiser, school, learner; CSV download.
- [ ] Sponsor: quotation, accept, pay with a Paystack test card, return page, dashboard.
- [ ] Certificates print and verify by QR.
- [ ] Notifications arrive.
- [ ] Existing practice, assignments, challenges and subscription payment still work.

## Switch off or undo

Set the four `flags.interschool*` settings to `false` to hide everything at once. Full removal: `preview_apply_interschool.ps1 -Rollback`, then close the branch.
