// One way to show a class level: the friendly name with the short code every other screen uses ("Class 5 (B5)"), so a learner never wonders if "B5" and "Class 5" are different.
export function gradeDisplay(label: string | null | undefined, code: string | null | undefined): string {
  const l = (label ?? "").trim(), c = (code ?? "").trim();
  if (l && c && l.toLowerCase() !== c.toLowerCase()) return `${l} (${c})`;
  return l || c || "-";
}
