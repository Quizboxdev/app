# Sponsored school pilot (staff-aimed)

A sponsor's challenge can be aimed at ONE school by QuizBox staff. It ships **off** behind `flags.sponsor_school_aiming` (migration `20261068100000_school_aimed_sponsored.sql`).
This is a pilot procedure, not self-service. It answers decision P-3 (`docs/quizbox-transformation/13_OPEN_DECISIONS_AND_RISKS.md`) for the pilot only: the evidence is held by staff, outside the system.

## What it does
- With the flag on, a platform administrator (owner or admin role, or the `super_admin` / `campaign_admin` capability) is offered every active school in the audience picker, and the classes of verified schools.
- Staff can aim a challenge at a school (or one of its classes) only after the school is marked **verified**. Otherwise the save is refused with `SCHOOL_NOT_VERIFIED`.
- A school administrator aiming at their own school, and a teacher aiming at their own class, are unaffected.
- Aimed challenges are never listed publicly (visibility becomes UNLISTED), only members of that school can join, and they are notified when it goes live.
- The challenge page says "Sponsored by <organiser name>" when the quiz is in the Sponsor category and aimed at a school. It never names the school.
- Managed under-13 learners stay excluded from joining and from notifications; nothing here changes that rule.

## Staff procedure
1. **Agree with the school** (head teacher or ICT coordinator) and collect the evidence: the school's GES / EMIS number and a signed letter authorising the challenge. Keep these in the QuizBox staff records, **not** in the app and not in the repository.
2. **Make sure the school exists on QuizBox** with a teacher, a class and learners joined. Nobody can see the challenge unless they are in the school's classes, and learners under 13 cannot take part. Plan for JHS or SHS classes with approved questions at their level.
3. **The sponsor makes the quiz** as a draft in the Sponsor category with their organiser name. A platform administrator may open and edit any draft by its address, `/creator/<campaign id>` (the creator list only shows your own quizzes, so ask the sponsor for the address of their draft).
4. **Mark the school verified** (owner, admin or super admin only). There is no admin screen for this yet. The function checks who is calling, and the Supabase SQL editor has no signed-in user, so run it as yourself in one run (Preview first):
   ```sql
   select set_config('request.jwt.claim.sub', '<your own user id>', false);
   select public.institution_set_verified('<school id>', true, 'EMIS no. and signed letter on file (ref 2026-NN)');
   ```
   The `setSchoolVerified` wrapper in `lib/api/challenges.ts` is there for a future admin screen. The note only points to the evidence. Never put names, phone numbers or other personal data in it.
5. **Aim the draft** at the school in the "Aim this challenge at a class or school" panel on the challenge's page, then **publish**.
6. To withdraw the mark, set the user id as above and run `select public.institution_set_verified('<school id>', false);`. This blocks new aiming; challenges already live keep running.

## What it does NOT do
- Sponsors cannot pick a school themselves. Only staff can.
- It does not handle prizes. Prize details stay off the platform and are the organiser's responsibility.
- It does not name an alumni association or a school publicly. Naming needs written consent (open legal items L-5 and L-6).
- It does not verify a school automatically, and it does not add an admin screen for verification.

## Apply and rollback
- Apply to Preview first, then compare fingerprints (`docs/release/`). Turn the flag on only in Preview until a pilot school has agreed: set `flags.sponsor_school_aiming` to `true` in `platform_settings`.
- Rollback: `supabase/rollback/school_aimed_sponsored.sql` restores the two replaced functions exactly and drops the three new ones. The verification columns and the flag row stay in place, so the record of verified schools is not lost.
