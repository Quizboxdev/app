"""Splits a migration into small parts for pasting into the Supabase SQL editor (long pastes get cut off).
Usage: python scripts/release/split_migration.py <migration.sql> <output-folder> [prefix]
Cuts only at the start of a top-level statement, so every part is complete SQL; run the parts in order."""
import pathlib, re, sys

LIMIT = 8500
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
prefix = sys.argv[3] if len(sys.argv) > 3 else "part"
# Parts are pasted one at a time, so a begin; in one part and a commit; in another would roll the first part back: drop both.
lines = [l for l in src.read_text(encoding="utf-8").split("\n") if l.strip().lower() not in ("begin;", "commit;")]
starts = [i for i, l in enumerate(lines) if re.match(r"^(create or replace function|create table|create index|create unique index|create trigger|drop trigger|drop function|revoke all|grant execute|alter table|insert into|do \$do\$|-- \d+\.)", l)]
chunks, prev = [], 0
for s in starts[1:] + [len(lines)]:
    chunks.append("\n".join(lines[prev:s])); prev = s
parts, buf = [], ""
for c in chunks:
    if buf and len(buf) + len(c) > LIMIT:
        parts.append(buf); buf = ""
    buf += c + "\n"
parts.append(buf)
out.mkdir(parents=True, exist_ok=True)
for f in out.glob(f"{prefix}*.sql"):
    f.unlink()
for i, p in enumerate(parts, 1):
    (out / f"{prefix}{i}.sql").write_text(p, encoding="utf-8")
print(len(parts), "parts:", [len(p) for p in parts])
