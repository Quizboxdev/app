// Reads the load plan written by stage_delta.py (LOAD_PLAN_<Environment>.csv): one line per file, in the order they should be loaded, with an hourly session number.
// The scheduled loader follows this order. Files are found under the folder the plan sits in (its `file` column is relative to that folder).
export type PlanEntry = { seq: number; session: number; environment: string; grade: string; subject: string; kind: string; rows: number; file: string };

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parsePlan(text: string): PlanEntry[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  for (const need of ["seq", "session", "file", "rows"]) if (!head.includes(need)) throw new Error(`The load plan has no "${need}" column (found: ${head.join(", ")}).`);
  const col = (cells: string[], name: string) => (cells[head.indexOf(name)] ?? "").trim();
  const entries = lines.slice(1).map((line, i) => {
    const cells = parseLine(line), seq = Number(col(cells, "seq")), rows = Number(col(cells, "rows")), session = Number(col(cells, "session"));
    if (!Number.isFinite(seq) || !Number.isFinite(rows) || !Number.isFinite(session)) throw new Error(`Load plan line ${i + 2} has a non-numeric seq, session or rows.`);
    return { seq, session, environment: col(cells, "environment"), grade: col(cells, "grade"), subject: col(cells, "subject"), kind: col(cells, "kind"), rows, file: col(cells, "file").split("\\").join("/") };
  });
  return entries.sort((a, b) => a.seq - b.seq);
}
