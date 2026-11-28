import type { EditableQuestion, Passage } from "./types";

// Chat assistants rarely copy a quote character for character: they straighten curly quotes, change dashes, drop or add commas, fix spacing, or cut the middle with "...".
// The database accepts a quote only if it appears in the passage (ignoring case and spacing). So before saving, each quote is looked up in the book ignoring everything
// except letters and digits, and replaced by the passage's own wording. A quote that is genuinely not in the book (reworded) is still refused, with its line number.

// Letters and digits only, lower case, accents removed; each kept character remembers where it came from in the original text.
function letters(text: string): { flat: string; from: number[]; to: number[] } {
  let flat = ""; const from: number[] = [], to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const kept = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    for (const k of kept) { flat += k; from.push(i); to.push(i + ch.length); }
    i += ch.length;
  }
  return { flat, from, to };
}

const MIN_LETTERS = 12;   // shorter than this could match by chance
const MAX_QUOTE = 300;    // the paste box's limit

// The passage's own wording for a quote, or null if the quote is not in the passage. With "..." the longest piece that is found is used.
export function exactQuote(body: string, quote: string, b = letters(body)): string | null {
  const pieces = quote.split(/\.{3,}|…/).map((p) => ({ p, flat: letters(p).flat })).filter((x) => x.flat.length >= MIN_LETTERS).sort((x, y) => y.flat.length - x.flat.length);
  for (const { flat } of pieces) {
    const at = b.flat.indexOf(flat);
    if (at < 0) continue;
    const text = body.slice(b.from[at], b.to[at + flat.length - 1]).trim();
    return text.length <= MAX_QUOTE ? text : text.slice(0, MAX_QUOTE).trim();
  }
  return null;
}

export type Unplaced = { question: EditableQuestion; line: number; reason: "NO_QUOTE" | "NOT_FOUND" };

// Attach each pasted question to the passage its quote comes from: the chosen passage first, then any passage of the material.
// Questions without a quote keep the chosen passage (if any); in a book challenge they cannot be saved, because every question must quote the book.
export function placeQuestions(questions: EditableQuestion[], lines: number[], passages: Passage[], chosen: Passage | null, book: boolean): { placed: EditableQuestion[]; unplaced: Unplaced[] } {
  const order = (chosen ? [chosen, ...passages.filter((p) => p.id !== chosen.id)] : passages).map((p) => ({ p, index: letters(p.body) }));
  const placed: EditableQuestion[] = [], unplaced: Unplaced[] = [];
  questions.forEach((q, n) => {
    const line = lines[n] ?? n + 1, quote = q.source_quote?.trim();
    if (!quote) {
      if (book) unplaced.push({ question: q, line, reason: "NO_QUOTE" });
      else placed.push(chosen ? { ...q, source_chunk_id: chosen.id } : q);
      return;
    }
    for (const { p, index } of order) {
      const exact = exactQuote(p.body, quote, index);
      if (exact) { placed.push({ ...q, source_chunk_id: p.id, source_quote: exact }); return; }
    }
    unplaced.push({ question: q, line, reason: "NOT_FOUND" });
  });
  return { placed, unplaced };
}

// A question written back as one line the paste box accepts, so refused lines can be fixed and added again.
const field = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const toCsvLine = (q: EditableQuestion) =>
  [q.question_text, ...[0, 1, 2, 3].map((i) => q.options[i] ?? ""), String.fromCharCode(65 + q.correct_index), q.explanation ?? "", q.source_quote ?? ""].map(field).join(",");
