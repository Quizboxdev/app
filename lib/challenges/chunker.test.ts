import { describe, expect, it } from "vitest";
import { chunkText, passagePrompt, sha256Hex } from "./chunker";

const para = (n: number, word = "Ananse") => `${word} gathered the wisdom of the world in a clay pot. `.repeat(n).trim();

describe("chunkText", () => {
  it("splits on headings and carries the latest heading", () => {
    const out = chunkText(`CHAPTER ONE\n\n${para(10)}\n\nChapter Two\n\n${para(10, "Kweku")}`);
    expect(out.map((c) => c.heading)).toEqual(["CHAPTER ONE", "Chapter Two"]);
    expect(out[1].body.startsWith("Kweku")).toBe(true);
  });
  it("keeps every passage within bounds and never loses text", () => {
    const text = Array.from({ length: 60 }, (_, i) => para(6, `Word${i}`)).join("\n\n");
    const out = chunkText(text, 400);
    for (const c of out) { expect(c.body.length).toBeGreaterThanOrEqual(20); expect(c.body.length).toBeLessThanOrEqual(2400); }
    expect(out.map((c) => c.body).join(" ").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });
  it("breaks one very long paragraph at sentence ends", () => {
    const out = chunkText(para(120));
    expect(out.length).toBeGreaterThan(3);
    for (const c of out) expect(c.body.endsWith(".")).toBe(true);
  });
  it("respects the passage limit and ignores blank input", () => {
    expect(chunkText(Array.from({ length: 50 }, (_, i) => para(30, `P${i}`)).join("\n\n"), 5)).toHaveLength(5);
    expect(chunkText("  \n\n ")).toEqual([]);
  });
  it("hashes bytes and builds a prompt that carries the passage", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const prompt = passagePrompt("The Tale", { heading: "Chapter 1", body: "Ananse wanted all the wisdom." }, 5);
    expect(prompt).toContain("Write 5 different"); expect(prompt).toContain("Ananse wanted all the wisdom."); expect(prompt).toContain("Chapter 1");
  });
});

import { buildSections } from "./chunker";
const c = (heading: string | null, i: number) => ({ heading, body: `Passage ${i} of the document text goes here for the test.` });

describe("buildSections", () => {
  it("starts a section at each chapter heading and keeps sub-headings inside their chapter", () => {
    const chunks = [c("Chapter 1: The River", 1), c("The source", 2), c("The mouth", 3), c("Chapter 2: The Harvest", 4), c("Chapter 2: The Harvest", 5), c("Chapter 3: The Market", 6)];
    expect(buildSections(chunks)).toEqual([{ title: "Chapter 1: The River", first: 1, last: 3 }, { title: "Chapter 2: The Harvest", first: 4, last: 5 }, { title: "Chapter 3: The Market", first: 6, last: 6 }]);
  });
  it("calls text before the first chapter an introduction, and understands numbered titles and surahs", () => {
    expect(buildSections([c(null, 1), c("1. Our values", 2), c("2. Our promise", 3)])).toEqual([{ title: "Introduction", first: 1, last: 1 }, { title: "1. Our values", first: 2, last: 2 }, { title: "2. Our promise", first: 3, last: 3 }]);
    expect(buildSections([c("Surah 1", 1), c("Surah 2", 2), c("Surah 2", 3)]).map((s) => s.title)).toEqual(["Surah 1", "Surah 2"]);
  });
  it("uses any headings when none is a chapter heading, and even parts when there are none", () => {
    expect(buildSections([c("OUR PRODUCTS", 1), c("OUR PRICES", 2)]).map((s) => s.title)).toEqual(["OUR PRODUCTS", "OUR PRICES"]);
    const flat = Array.from({ length: 25 }, (_, i) => c(null, i + 1));
    expect(buildSections(flat)).toEqual([{ title: "Part 1", first: 1, last: 10 }, { title: "Part 2", first: 11, last: 20 }, { title: "Part 3", first: 21, last: 25 }]);
    expect(buildSections([c("ONLY ONE HEADING", 1), c("ONLY ONE HEADING", 2)])).toEqual([{ title: "Part 1", first: 1, last: 2 }]);
    expect(buildSections([])).toEqual([]);
  });
  it("always covers every passage without gaps or overlaps, and never exceeds 80 sections", () => {
    const many = Array.from({ length: 300 }, (_, i) => c(`Chapter ${i + 1}`, i + 1));
    const out = buildSections(many);
    expect(out.length).toBeLessThanOrEqual(80); expect(out[0].first).toBe(1); expect(out[out.length - 1].last).toBe(300);
    out.slice(1).forEach((s, i) => expect(s.first).toBe(out[i].last + 1));
  });
});
