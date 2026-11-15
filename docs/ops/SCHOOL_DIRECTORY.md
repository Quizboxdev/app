# School directory

One accurate list of schools (Region, then District, then School) that students and teachers pick from, with a **Public / Private** filter and a **Primary / JHS / SHS** filter. Schools a user cannot find are added by the user and wait for staff approval.

Migration `20261074100000_school_directory.sql` (rollback `supabase/rollback/school_directory.sql`). Everything is off until `flags.school_directory` is switched on.

## What is in this release

| Piece | Where |
|---|---|
| Directory table, filters, add-a-school queue, approve / reject / merge, CSV import | the migration |
| Staff screen (Waiting, Approved, Rejected, Merged, Import list) | Admin, **School directory** (`/admin/schools`), super admin only |
| Browser wrappers for the pickers (regions, districts, search, add, set my school) | `lib/api/schools.ts` |
| CSV reader for the QuizBox school format | `lib/schools/csv.ts` |

**Not in this release:** the student and teacher "Set up your school" screens and the shorter sign-up form. They use the functions above and come next.

## How names stay accurate

- One school per region, district and name (letters and digits only, so "St. Mary's JHS" and "ST MARYS JHS" are the same school). A second copy cannot be saved.
- A user who adds a missing school gets the existing school back if there is a look-alike. A new one waits as **pending**; the user can use it straight away.
- Staff see look-alikes next to each waiting school and can **merge** (everyone who used the new name is moved to the listed school), **approve** with a corrected spelling, or **reject** with a reason (people who used it are asked to pick again).
- Staff can correct an approved school later; everyone linked to it sees the corrected name.
- A person's first school link is free. A later change is a profile edit (students keep the existing two-edits-in-six-months rule).
- A user may have at most 5 schools waiting at once.

## Owner steps (nothing here is done by the code)

1. Review and merge the pull request. Nothing changes for users yet.
2. Apply the migration to **Preview** (paste the five parts in `docs/release/sql-parts/20261074100000/`, in order). Run fingerprint B and check `20261074100000` reads `ok`.
3. Sign in as super admin on Preview. Open **Admin, School directory, Import list**. Choose `schools_private_nasia_clean.csv` (about 6,600 schools; kindergarten-only and no-level rows are skipped by the screen). Click **Load schools**. It loads in chunks of 400 and can be run twice safely.
4. Check a few schools in **Approved**, then switch the flag on for Preview only:
   `update public.platform_settings set value = 'true'::jsonb where key = 'flags.school_directory' and scope_type = 'global';`
5. Do the same on Production in a quiet period once the pickers are built and tested on Preview.

## Data sources

- Private schools: NaSIA licensing directory, active 2026 licences (district level, no town).
- Public schools: to come (GES / EMIS lists through Firecrawl; format in `Content/Schools/FIRECRAWL_SCHOOL_DATA_SPEC.md`). Load them the same way; schools already listed only get their blanks filled.
- Not used: schoolsingh.com (its `robots.txt` blocks automated crawlers).

## What this does not touch

`public.institutions` (schools that run classes and competitions), the public school count and the sponsor school pickers are unchanged. `school_directory.institution_id` links the two later, when a directory school is actually used for classes or competitions.

## Rollback

`supabase/rollback/school_directory.sql` switches the flag off and drops the functions. The table and the two `school_directory_id` columns stay, so no school or link is lost.
