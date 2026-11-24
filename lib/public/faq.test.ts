import { describe, expect, it } from "vitest";
import { FAQS, faqJsonLd, faqsFor } from "./faq";

describe("public FAQ", () => {
  it("has home and parents lists, each question once, every answer written out", () => {
    expect(faqsFor("home").length).toBeGreaterThanOrEqual(5);
    expect(faqsFor("parents").length).toBeGreaterThanOrEqual(5);
    expect(new Set(FAQS.map((f) => f.id)).size).toBe(FAQS.length);
    for (const f of FAQS) { expect(f.q.endsWith("?")).toBe(true); expect(f.a.length).toBeGreaterThan(40); }
  });
  it("states no measured-sounding figure: no data sizes, hours saved, percentages, or 'complete' / 'accredited' claims", () => {
    const text = FAQS.map((f) => `${f.q} ${f.a}`).join(" ");
    expect(text).not.toMatch(/\bMB\b|\bGB\b|\d+\s?%|\bhours?\b|\baccredited\b|\bcomplete syllabi\b|\b100\b/i);
  });
  it("builds structured data from the same list", () => {
    const ld = faqJsonLd(faqsFor("home"));
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity.map((e) => e.name)).toEqual(faqsFor("home").map((f) => f.q));
  });
});
