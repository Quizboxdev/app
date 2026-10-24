import { describe, expect, it } from "vitest";
import { TONE } from "./PricingCards";

// Audit UX-001: the sponsor "N Coins" chips were 3.35:1 (orange on cream). Every tone's text colour must stay readable on its own background.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe("pricing tones", () => {
  for (const [name, tone] of Object.entries(TONE)) {
    it(`${name}: ring text on the soft background is at least 4.5:1`, () => {
      expect(ratio(tone.ring, tone.soft)).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const [name, tone] of Object.entries(TONE)) {
    it(`${name}: the text on the coloured band is at least 4.5:1 at every colour stop`, () => {
      const stops = tone.band.match(/#[0-9a-fA-F]{6}/g) ?? [];
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) expect(ratio(tone.ink, stop)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
