# UAT UX improvements log

Logged 2026-10-06 from confirmed UAT findings. No code, data, roles or production state were changed.

## Role decisions (confirmed by owner)
- `eddyran2008@gmail.com` stays platform admin only.
- `admin.test@quizbox.local` is the Super Admin UAT account.

## UX-1: Admin header does not distinguish platform admin from super admin
- Observed: the admin header looks the same for both roles.
- Wanted: show the signed-in role explicitly (e.g. "Platform Admin" vs "Super Admin" badge).
- Status: logged, not implemented.

## UX-2: /admin/markets shows only the raw server refusal
- Observed: a platform admin without Super Admin rights sees the raw server refusal.
- Wanted: a role-specific access state, e.g. "Markets is restricted to Super Admins. You are signed in as Platform Admin."
- Status: logged, not implemented.

## Content Operations UAT parameters (read-only)
- Curriculum = Ghana Common Core Programme; Source = production; Status = review; Batch blank; all other filters default.
  - Expected: 93 items.
- Batch `1f480282-b8dc-42d4-a3d5-e2c8990ce7f8` (other filters as above)
  - Expected: 10 items.
- No seeding, mutation or reclassification.
