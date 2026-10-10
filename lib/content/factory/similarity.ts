import { normalize } from "./contract";

// Word-overlap similarity (Jaccard) of two question stems. Pure code: safe in the browser (duplicates.ts needs node:crypto).
export function similarity(a: string, b: string): number {
  const x = new Set(normalize(a).split(" ").filter(Boolean)), y = new Set(normalize(b).split(" ").filter(Boolean));
  const union = new Set([...x, ...y]); return union.size ? [...x].filter((word) => y.has(word)).length / union.size : 0;
}
