# Help video library: applying it to the database (migration 20261123100000)

PR: https://github.com/Quizboxdev/app/pull/131. Branch: `claude/help-video-library`.

## What changes
- **Admin, Help videos** (`/admin/help/videos`, linked from Help guides): paste a YouTube link, give the video a title, say who it is for and which Help guides it appears on, then publish. The screen shows plays inside QuizBox and clicks through to YouTube for every video.
- **On each Help guide** (inside the app at `/guides/<name>` and on the website at `/help/<name>`): a "Watch how it works" card for every published video linked to that guide. The picture is a thumbnail; the YouTube player (privacy-enhanced, youtube-nocookie.com) loads only after the person presses play. **Watch on YouTube** goes to `/go/video/<id>`, which counts the click and sends the person to the video on QuizBox's channel.
- No videos linked means no change to a guide. Until the database change is applied, the guides look exactly as before (the video lookup returns nothing and the card stays hidden). The Admin, Help videos screen shows "That did not work" until the database change is applied.
- The Content-Security-Policy now allows `https://www.youtube-nocookie.com` (frames) and `https://i.ytimg.com` (thumbnails). It stays report-only until `QB_CSP_MODE=enforce` is set.

## What the database change does (and does not do)
- **Adds** two tables, `help_videos` (the videos and their two counters) and `help_video_links` (which guide a video belongs to), and eight functions named `qb_help_video...`.
- **Does not touch** any existing table, row, guide, user or setting. It only reads `help_articles` (to check a guide exists) and `profiles` (through the existing support-staff check).
- **Safe to run twice.** Every statement is "create if not exists" or "create or replace".
- **Closed to browsers.** Neither table can be read by anyone signed in or signed out. Only the functions work: visitors can read published videos of published guides; support staff manage; only the server writes the counters.
- **Reversible.** `supabase/rollback/help_videos.sql` removes everything it added.

## Order
1. Apply to **Preview** (database project `fngdtxayfoiffbcbmcum`) and try one video end to end (section 4).
2. Merge PR #131 and let Vercel deploy. The site code is harmless before the database is applied, so the order of merge and apply does not matter.
3. Apply to **Production** (database project `fmgccmqxfjppqydkhaiu`) the same way. Do not add a test video on Production: add a real video only when one is ready.

## 1. Check the starting point (about one minute)
Supabase dashboard, the right project, SQL editor, New query. Paste this and Run:

```sql
select
  to_regclass('public.help_articles') is not null                                   as help_articles_ok,
  to_regprocedure('public.qb_support_is_staff()') is not null                       as support_check_ok,
  to_regprocedure('public.qb_consume_budget(text,integer,integer)') is not null     as budget_ok,
  to_regclass('public.help_videos') is not null                                     as already_applied;
```
Expect `true, true, true, false`.
- First value `false`: the Help centre is not applied yet. Apply `docs/release/APPLY_HELP.md` first.
- Second value `false`: apply the support requests change, `docs/release/APPLY_SUPPORT.md`, first.
- Third value `false`: the play and click limiter is missing. It comes from migration `20261019150000_managed_learners.sql` (see `docs/release/APPLY_2026-10-19.md`). Apply that first.
- Fourth value `true`: it is already applied. You can still run the parts again; nothing changes.

## 2. Apply the two parts
The migration is split into two parts so each is small enough to paste. **Run part 1 first and let it finish, then part 2.** For each part: run the copy command, paste into a new query in the SQL editor, press Run, and expect "Success. No rows returned".

Part 1 (tables, row security, reading, counters, admin list, save):

```
Get-Content "C:\Users\USER\dev\codebase\docs\release\sql-parts\20261123100000\p1.sql" -Raw | Set-Clipboard
```

Part 2 (publish and delete, permissions, schema reload):

```
Get-Content "C:\Users\USER\dev\codebase\docs\release\sql-parts\20261123100000\p2.sql" -Raw | Set-Clipboard
```

If you are working from another folder, the same two files are in the repository at `docs/release/sql-parts/20261123100000/p1.sql` and `p2.sql`.

If part 1 shows an error, do not run part 2. Copy the error text and see "If something goes wrong" below; fix it, then run part 1 again (it is safe to repeat).

## 3. Verify the database (about two minutes)
Run each query in a new query tab.

Query A, the objects exist. Expect 8 rows:

```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'qb_help_video%' order by 1;
```
The eight names are `qb_help_video_admin_list`, `qb_help_video_delete`, `qb_help_video_outbound`, `qb_help_video_save`, `qb_help_video_set_state`, `qb_help_video_track`, `qb_help_videos_for` and `qb_help_videos_list`.

Query B, both tables exist with row security on. Expect 2 rows, both `true`:

```sql
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('help_video_links', 'help_videos') order by 1;
```

Query C, the right people can use the right functions. Expect exactly this one row: `true, true, false, true, true, false, false`:

```sql
select
  has_function_privilege('anon', 'public.qb_help_videos_for(text)', 'execute')                      as visitor_can_read,
  has_function_privilege('authenticated', 'public.qb_help_videos_list(text)', 'execute')            as signed_in_can_list,
  has_function_privilege('anon', 'public.qb_help_video_track(uuid,text)', 'execute')                as visitor_can_count,
  has_function_privilege('service_role', 'public.qb_help_video_track(uuid,text)', 'execute')        as server_can_count,
  has_function_privilege('authenticated', 'public.qb_help_video_admin_list()', 'execute')           as signed_in_can_call_admin,
  has_function_privilege('anon', 'public.qb_help_video_admin_list()', 'execute')                    as visitor_can_call_admin,
  has_table_privilege('authenticated', 'public.help_videos', 'select')                              as signed_in_can_read_table;
```
(`signed_in_can_call_admin` is true because the function itself then refuses anyone who is not support staff; Query E checks that.)

Query D, the tables are empty and the reading function answers. Expect `0, 0, []`:

```sql
select (select count(*) from public.help_videos) as videos, (select count(*) from public.help_video_links) as links, public.qb_help_videos_list() as listed;
```

Query E, a signed-in person who is not staff is refused. Run it in one go; the expected result is the error `QB_FORBIDDEN` (that error is the pass):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
select public.qb_help_video_admin_list();
rollback;
```
After the error, run `rollback;` once on its own so the editor session is clean.

## 4. Try one video end to end on Preview (about ten minutes)
You need a video on the QuizBox YouTube channel. Any short public or unlisted video will do for the test.
1. Sign in to Preview as an **admin or support** account. Open Admin, Help guides, then the new **Help videos** button.
2. Press **New video**. Paste the YouTube link. A thumbnail appears under the fields: that means the link was understood. Give a title (at least 3 letters), tick **Learners** (or the group that fits), and tick one guide, for example *Create a class*. Press **Save and publish**. Expect "Published. It now shows on its guides."
3. In a private browser window (signed out), open `https://preview.quizbox.io/help/<that guide's web name>`. Expect a "Watch how it works" card with the thumbnail and a play button. Nothing from YouTube has loaded yet except the thumbnail.
4. Press play. The video starts in the privacy-enhanced player.
5. Press **Watch on YouTube**. A new tab opens on the video at `youtube.com`.
6. Signed in, open the same guide inside the app at `/guides/<web name>`: the card shows there too.
7. Back in Admin, Help videos: expect **Plays 1** and **To YouTube 1** for that video. Pressing play or the link again within the hour on the same device does not add to the counts (this is on purpose).
8. Press **Switch back to draft**. Refresh the public guide: the card is gone. This is the quickest way to take a video down.
9. Test cleanup: with the video in draft, press **Delete draft**. Expect "Deleted."

If every step behaved as described, the feature is working on Preview.

## 5. Apply to Production
After the Preview test, and PR #131 merged and deployed:
1. Open the **Production** Supabase project (`fmgccmqxfjppqydkhaiu`).
2. Repeat section 1 (the starting-point check), section 2 (the two parts) and section 3 (Queries A to E).
3. Do **not** add a test video. Add the first real video from Admin, Help videos when it is ready (narration, captions and privacy review done).

## If something goes wrong
| What you see | Meaning | What to do |
|---|---|---|
| Part 1 error `relation "public.help_articles" does not exist` | The Help centre is not applied | Apply `APPLY_HELP.md` first, then repeat part 1 |
| Part 1 error `function public.qb_support_is_staff() does not exist` | The support requests change is missing | Apply `APPLY_SUPPORT.md` first, then repeat part 1 |
| Part 2 error `function ... does not exist` in the permissions | Part 1 did not finish | Run part 1 again, then part 2 |
| Admin, Help videos says "That did not work. Please try again." | The database change is not applied to the project the site reads (the Preview site reads the Preview database) | Check you applied to the right project, run Query A |
| Admin says "Only support staff can manage Help videos." | The account is not owner, admin, super admin or support | Sign in with a support-level account |
| Admin says "That YouTube video is already in the library." | The same video was added before | Edit the existing one, or delete the draft |
| The card does not show on a guide | The video is a draft, not linked to that guide, or the guide itself is a draft | In Admin, Help videos: the status must be `published`, and the guide must be ticked and published |
| The play button shows but the video does not start | The video is private or embedding is switched off on YouTube | In YouTube Studio set it Public or Unlisted and allow embedding |
| Watch on YouTube lands on the Help centre | The video is a draft or was deleted | Publish it again |
| The thumbnail is missing | YouTube has not made it yet, or the build does not include PR #131 | Wait a few minutes; make sure the deployed build includes PR #131 |

## Back out
Only if you need to remove the feature. The videos, their links and their counters are deleted; the Help guides are not touched. To keep the list first, run:

```sql
select title, youtube_id, state, plays, outbound from public.help_videos order by title;
```
Save the result, then copy the rollback:

```
Get-Content "C:\Users\USER\dev\codebase\supabase\rollback\help_videos.sql" -Raw | Set-Clipboard
```
Paste into a new query and Run. Expect "Success. No rows returned". Run Query A again: it should return 0 rows.

## Handy facts
- Counters: a play is counted when someone presses play on a guide; a click is counted when someone presses Watch on YouTube. Each is counted once per video per device per hour. No names, emails or addresses are stored (the device is a one-way hash).
- Taking a video down: Admin, Help videos, Edit, **Switch back to draft**. It disappears from the guides at once. The YouTube video itself stays on the channel until you remove it there.
- Who can manage videos: owner, admin, super admin and support (the same people who manage Help guides).
