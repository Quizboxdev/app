"""Builds 20261023100000_challenges_moderation.sql: new objects written here, plus five existing functions re-declared from the extensions migration
with the moderation checks and notifications injected (so the original text is reused, not retyped)."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
ext = (ROOT / "supabase/migrations/20261022100000_challenges_extensions.sql").read_text(encoding="utf-8")


def fn(name: str) -> str:
    return re.search(r"create or replace function public\." + name + r"\(.*?\$fn\$;", ext, re.S).group(0)


def inject(text: str, old: str, new: str) -> str:
    assert old in text, old
    return text.replace(old, new, 1)


pub = inject(fn("challenge_publish"),
             "  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;",
             "  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;\n  if c.moderation_state <> 'OK' then raise exception 'TAKEN_DOWN' using errcode = '55000'; end if;")
fin = inject(fn("challenge_finalize"), "made := made + 1;\n  end loop;",
             "made := made + 1;\n    perform public.qb_challenge_notify(r.user_id, 'You won a prize', 'You ranked ' || r.rank || ' in ' || c.title || '. The organiser will contact you to arrange delivery.', '/play', 'reward');\n  end loop;")
aw = inject(fn("challenge_award_update"), "  perform public.qb_challenge_audit('challenge_award_' ",
            "  if p_status in ('CONTACTED','FULFILLED') then perform public.qb_challenge_notify(a.user_id, case p_status when 'FULFILLED' then 'Your prize has been delivered' else 'The organiser has contacted you about your prize' end, 'Open My challenges to see the details of your prize.', '/play', 'reward'); end if;\n  perform public.qb_challenge_audit('challenge_award_' ")
pg = inject(fn("challenge_public_get"), "  if not found then return null; end if;\n  if c.visibility = 'PRIVATE'",
            "  if not found then return null; end if;\n  if c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;\n  if c.visibility = 'PRIVATE'")
lb = inject(fn("challenge_leaderboard"), "if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;",
            "if not found or c.status not in ('LIVE','PAUSED','COMPLETED') or (c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin())) then return '[]'::jsonb; end if;")

head = (ROOT / "scripts/release/moderation_head.sql").read_text(encoding="utf-8")
tail = (ROOT / "scripts/release/moderation_tail.sql").read_text(encoding="utf-8")
(ROOT / "supabase/migrations/20261023100000_challenges_moderation.sql").write_text(head + "\n\n".join([pub, fin, aw, pg, lb]) + "\n" + tail, encoding="utf-8")
print("written")
