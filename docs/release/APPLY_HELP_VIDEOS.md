# Help video library (migration 20261123100000)

What changes:
- **Admin, Help videos** (`/admin/help/videos`, linked from Help guides): paste a YouTube link, give the video a title, say who it is for and which Help guides it appears on, then publish. The screen shows plays inside QuizBox and clicks through to YouTube for every video.
- **On each Help guide** (inside the app at `/guides/<name>` and on the website at `/help/<name>`): a "Watch how it works" card for every published video linked to that guide. The picture is a thumbnail; the YouTube player (privacy-enhanced, youtube-nocookie.com) loads only after the person presses play. **Watch on YouTube** goes to `/go/video/<id>`, which counts the click and sends the person to the video on QuizBox's channel.
- **On the Help home** (`/guides` inside the app, `/help` on the website): a **Watch and learn** row of up to eight video cards above the topics. A card opens the guide the video belongs to, where it plays. The row is hidden until at least one video is published, and while someone is searching.
- **Export CSV** on the Admin Help videos screen: one line per video with its guides, plays, clicks to YouTube and the share of clicks (opens in Excel).
- No videos linked means no change to a guide. Until the database change is applied the guides look exactly as before (the video lookup just returns nothing).
- The Content-Security-Policy now allows `https://www.youtube-nocookie.com` (frames) and `https://i.ytimg.com` (thumbnails). It is still report-only until `QB_CSP_MODE=enforce` is set.

## 1. Database (two parts)
Supabase SQL editor, Preview first. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice. Needs the Help centre migration (20261039100000) and the support staff function from the support migration already applied.

Part 1:
```
Get-Content "C:\Users\USER\dev\codebase\docs\release\sql-parts\20261123100000\p1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\dev\codebase\docs\release\sql-parts\20261123100000\p2.sql" -Raw | Set-Clipboard
```
Verify (expect 8 functions, then 2 rows both with true):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'qb_help_video%' order by 1;
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('help_videos','help_video_links') order by 1;
```
(The first query also matches `qb_help_videos_for` and `qb_help_videos_list`: expect 8 rows in total.)

## 2. Try it on Preview
1. Upload a video to the QuizBox YouTube channel (Public or Unlisted, with captions).
2. Admin, Help videos, New video: paste the link, add a title, tick one guide, Save and publish.
3. Open that guide at `/guides/<name>` and `/help/<name>`: the card shows; press play; press Watch on YouTube (a new tab opens on YouTube).
4. Back in Admin, Help videos: Plays 1, To YouTube 1.
5. Open the Help home (`/guides` and `/help`): the video shows in the **Watch and learn** row; pressing it opens its guide.
6. In Admin, Help videos, press **Export CSV**: the file lists the video with Plays 1 and clicks 1.
7. Switch the video back to draft: the card and the row entry disappear at once.

## Back out
Run `supabase/rollback/help_videos.sql` (removes the videos, their links and counters; guides are untouched).
