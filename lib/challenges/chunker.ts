// Turns extracted book text into passages a question can cite. Passages are 300 to 1,500 characters, break at paragraph then sentence boundaries,
// and carry the most recent heading. Pure and deterministic, so the same upload always yields the same passages.
export type Chunk = { heading: string | null; body: string };
const MAX = 1500, MIN = 300, HARD = 2400;

const isHeading = (line: string) => {
  const t = line.trim();
  if (t.length < 3 || t.length > 90 || /[.!?,;]$/.test(t)) return false;
  return /^(chapter|unit|section|part|lesson|topic)\b/i.test(t) || /^\d+(\.\d+)*[.)]?\s+\S/.test(t) || (t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(/\s+/).length <= 10);
};

function splitLong(text: string): string[] {
  const out: string[] = []; let rest = text.trim();
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf(". ", MAX); if (cut < MIN) cut = rest.lastIndexOf(" ", MAX); if (cut < MIN) cut = MAX;
    out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function chunkText(raw: string, limit = 400): Chunk[] {
  const text = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const chunks: Chunk[] = []; let heading: string | null = null; let buf = "";
  const flush = () => { const b = buf.trim(); if (b.length >= 20) for (const piece of splitLong(b)) if (piece.length >= 20) chunks.push({ heading, body: piece.slice(0, HARD) }); buf = ""; };
  for (const p of paragraphs) {
    if (isHeading(p)) { flush(); heading = p.slice(0, 160); continue; }
    if (buf && buf.length + p.length + 1 > MAX) flush();
    buf = buf ? `${buf} ${p}` : p;
    if (buf.length >= MIN * 2) flush();
  }
  flush();
  return chunks.slice(0, limit);
}


// Chapters. The reader and the "which parts can people read" choice work on sections: runs of consecutive passages that belong together. A document's own chapter headings
// ("Chapter 3", "Part II", "Surah 2", "Unit 4", numbered titles) decide where sections start; sub-headings stay inside their chapter. With no usable headings the text is cut into
// even parts. Always covers every passage, in order, without gaps, and never more than 80 sections.
export type Section = { title: string; first: number; last: number };
const MAJOR = /^(chapter|part|book|surah|unit|lesson|section|week|module|day|story)\b/i;
const NUMBERED = /^\d+[.)]\s+\S/;
const isMajor = (h: string | null) => !!h && (MAJOR.test(h.trim()) || NUMBERED.test(h.trim()));
const clip = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 80);

export function buildSections(chunks: Chunk[], opts: { block?: number; max?: number } = {}): Section[] {
  const n = chunks.length, max = opts.max ?? 80;
  if (!n) return [];
  const blocks = (size: number): Section[] => { const out: Section[] = []; for (let i = 0; i < n; i += size) out.push({ title: `Part ${out.length + 1}`, first: i + 1, last: Math.min(n, i + size) }); return out; };
  const heads = chunks.map((c) => c.heading);
  const majors = new Set(heads.filter(isMajor).map((h) => h as string));
  const distinct = new Set(heads.filter((h): h is string => !!h));
  // Which headings start a section.
  const starts = majors.size >= 2 ? (h: string | null) => isMajor(h) : distinct.size >= 2 ? (h: string | null) => !!h : null;
  if (!starts) return blocks(opts.block ?? 10);
  const out: Section[] = []; let prev: string | null | undefined;
  for (let i = 0; i < n; i++) {
    const h = heads[i];
    const begins = i === 0 || (starts(h) && h !== prev);
    if (begins) out.push({ title: i === 0 && !starts(h) ? "Introduction" : clip(h ?? "Introduction"), first: i + 1, last: i + 1 });
    else out[out.length - 1].last = i + 1;
    if (starts(h)) prev = h;
  }
  if (out.length > max) return blocks(Math.ceil(n / Math.min(max, 60)));
  return out;
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

// The question-writing prompt for a passage, to paste into a chat assistant. Output is the same CSV the paste box accepts, plus the verbatim quote.
export const passagePrompt = (title: string, chunk: Chunk, count: number) =>
`You are writing quiz questions for a QuizBox challenge based on the book "${title}".
Use ONLY the passage below. Write ${count} different multiple-choice questions a reader could answer from it. Rules: one clearly correct option, three plausible wrong options of similar length, no trick wording, plain text.
Output ONLY CSV lines, no header, no commentary, fields in double quotes: "question","option A","option B","option C","option D","correct letter A-D","one-sentence explanation","exact quote copied word for word from the passage (under 200 characters) that proves the answer"
${chunk.heading ? `Heading: ${chunk.heading}\n` : ""}PASSAGE:
${chunk.body}`;
