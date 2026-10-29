## What this changes and why
<!-- One or two sentences in plain words. Link the register item or issue (for example UX-011, QB-AUD-004). -->

## Kind of change
- [ ] Fix  - [ ] New feature  - [ ] Content or wording  - [ ] Database migration  - [ ] Settings or release tooling  - [ ] Documentation only

## Checks (all must be ticked, or say why not)
- [ ] `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` pass (CI runs the same)
- [ ] A test covers the change (a new test, or the existing test that would have caught it)
- [ ] I looked at it on a phone-width screen and a desktop screen (screenshots below if the screen changed)
- [ ] No secret, key, password or personal data in the code, the logs or the screenshots

## Needs the owner's explicit approval (tick if touched)
- [ ] Prices, payments, refunds, payouts or the marketplace split
- [ ] Who can see or do what (permissions, sign-in rules, row-level security)
- [ ] A database migration: apply guide in `docs/release/`, an undo script in `supabase/rollback/`, parts rebuilt with `python scripts/release/make_release_kit.py`, and the fingerprint is `ok` on Preview before Production
- [ ] Anything that changes what a learner under 13 can see or share

## How to undo it
<!-- Revert this pull request, or name the rollback script. -->

## Screenshots or evidence
