import { describe, expect, it } from "vitest";
import { exactQuote, placeQuestions, toCsvLine } from "./quote-match";
import { parseQuestionCsv } from "./csv";
import type { EditableQuestion, Passage } from "./types";

const body = "Chapter 3. “You are a new creation,” the pastor said — the old has gone; the new has come.\nKnow who you are in Christ, and live from that identity every day.";
const p1: Passage = { id: "p1", position: 1, heading: "Chapter 3", body };
const p2: Passage = { id: "p2", position: 2, heading: "Chapter 4", body: "Faith comes by hearing, and hearing by the word. Prayer is talking with God." };
const q = (quote?: string): EditableQuestion => ({ question_text: "What did the pastor say?", options: ["A new creation", "An old man", "A servant", "A stranger"], correct_index: 0, explanation: null, ...(quote ? { source_quote: quote } : {}) });
// The database's own check: lower case, spacing collapsed, then a plain "is it inside".
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const dbAccepts = (passage: string, quote: string) => norm(passage).includes(norm(quote));

describe("exactQuote", () => {
  it("finds a quote the assistant re-punctuated and returns the book's own wording", () => {
    const quote = '"You are a new creation," the pastor said - the old has gone';
    expect(dbAccepts(body, quote)).toBe(false);                      // what failed before
    const exact = exactQuote(body, quote)!;
    expect(exact).toBe("You are a new creation,” the pastor said — the old has gone");
    expect(dbAccepts(body, exact)).toBe(true);
  });
  it("copes with changed spacing, line breaks, case and accents", () => {
    expect(exactQuote(body, "the NEW has come.  Know who you are in   Christ")).toBe("the new has come.\nKnow who you are in Christ");
    expect(exactQuote("The café was full of people.", "the cafe was full")).toBe("The café was full");
  });
  it("uses the longest piece of a quote cut with an ellipsis", () => {
    expect(exactQuote(body, "Know who you are in Christ ... from that identity")).toBe("Know who you are in Christ");
  });
  it("refuses a reworded quote and anything too short to be sure of", () => {
    expect(exactQuote(body, "you have become a brand new person")).toBeNull();
    expect(exactQuote(body, "the old")).toBeNull();
  });
});

describe("placeQuestions", () => {
  it("looks in the chosen passage first, then the rest of the book", () => {
    const r = placeQuestions([q("the pastor said, the old has gone"), q("Prayer is talking with God")], [1, 2], [p1, p2], p1, true);
    expect(r.unplaced).toEqual([]);
    expect(r.placed.map((x) => x.source_chunk_id)).toEqual(["p1", "p2"]);
    expect(r.placed[1].source_quote).toBe("Prayer is talking with God");
  });
  it("gives back unmatched and quote-less lines with their line numbers", () => {
    const r = placeQuestions([q("Jesus wept for Lazarus"), q(), q("Faith comes by hearing")], [4, 7, 9], [p1, p2], null, true);
    expect(r.placed).toHaveLength(1);
    expect(r.unplaced.map((u) => [u.line, u.reason])).toEqual([[4, "NOT_FOUND"], [7, "NO_QUOTE"]]);
  });
  it("outside a book challenge, questions without quotes are kept and cite the chosen passage", () => {
    expect(placeQuestions([q()], [1], [], p2, false).placed[0].source_chunk_id).toBe("p2");
  });
});

describe("pasting a chat assistant's answer as it is", () => {
  const answer = [
    "Here are 5 questions based on the passage:",
    "```csv",
    '1. "What did the pastor say?","A new creation","An old man","A servant","A stranger","A","He called them new.","You are a new creation, the pastor said"',
    '"What should we live from?","Our feelings","Our identity","Our past","Our work","B.","Identity in Christ.","live from that identity every day"',
    "```",
    "Let me know if you want more!",
  ].join("\n");
  it("ignores the chatter, code block and numbering, and matches every quote", () => {
    const parsed = parseQuestionCsv(answer);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual([3, 4]);
    const r = placeQuestions(parsed.questions, parsed.lines, [p1, p2], null, true);
    expect(r.unplaced).toEqual([]);
    for (const x of r.placed) expect(dbAccepts(body, x.source_quote!)).toBe(true);
  });
  it("writes a refused question back as a line the box accepts", () => {
    const line = toCsvLine({ ...q('He said "hello"'), options: ["Yes", "No"], correct_index: 1 });
    const back = parseQuestionCsv(line);
    expect(back.errors).toEqual([]);
    expect(back.questions[0]).toMatchObject({ options: ["Yes", "No"], correct_index: 1, source_quote: 'He said "hello"' });
  });
});
