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
