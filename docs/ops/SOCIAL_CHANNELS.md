# Social channels (admin-managed)

Super admin page: **Admin, Operations, Social channels** (`/admin/social`). Add, edit, hide, reorder and delete the channels shown in the **Follow QuizBox** corner at the bottom left of the app menu.

Migration `20261076100000_social_channels.sql` (rollback `supabase/rollback/social_channels.sql`). Off until `flags.social_channels` is on; with it off the menu keeps showing the built-in six channels (`lib/public/social.ts`), so applying the migration changes nothing visible.

## What staff can add
WhatsApp number (stored as digits, opens `https://wa.me/<digits>`), WhatsApp channel or group link, Telegram, TikTok, Instagram, Facebook, YouTube, LinkedIn, Snapchat, X, email (`mailto:`), website. Up to 30.

## Safety rules (enforced in the database)
- Links must be `https://` on the platform's own site (an Instagram channel must be on instagram.com; `instagram.com.evil.example` is refused). Website accepts any https address.
- Names and handles cannot contain `<` or `>`; control characters are removed.
- Only a super admin can read the full list or change it. Everyone (even signed out) can read the active channels through `qb_social_channels()`, which returns only name, kind, handle and link.

## Owner steps
1. Merge the pull request. Nothing changes yet.
2. Apply the migration on Preview (`.\scripts\release\Copy-Sql.ps1 -Migration 20261076100000`), check fingerprint B reads `ok` for `20261076100000`.
3. Open Admin, Social channels. The six current channels are already listed. Add a WhatsApp number or Telegram link, reorder, then click **Switch on**.
4. Reload the app: the menu corner shows the managed list. The student home "Connect with QuizBox" card then shows only "Tell a friend".

## Not included yet
The public footer and the contact page still use the built-in list. They can read the same list in a follow-up.
