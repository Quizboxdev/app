// A round's results as a spreadsheet file: exactly what the viewer is allowed to see on screen, nothing more.
import type { Results } from "./types";

// A cell that a spreadsheet would read as a formula is written as text.
export const csvCell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
export function resultsCsv(r: Results): string {
  const rows: unknown[][] = [["Competition", r.competition], ["Division", r.division], ["Round", r.round], [], ["School rank", "School", "Score", "Total", "Took part", "Entered", "Through"],
    ...(r.schools ?? []).map((s) => [s.rank, s.school, s.score, s.total_score, s.present, s.entered, s.qualified ? "Yes" : "No"])];
  if (r.learners?.length) rows.push([], ["Learner rank", "Learner", "School", "Score", "Out of", "Percent", "Seconds", "Absent", "Through"],
    ...r.learners.map((l) => [l.rank, l.name, l.school, l.score, l.max_score, l.percent, l.seconds, l.absent ? "Yes" : "No", l.qualified ? "Yes" : "No"]));
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
