import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND_DESCRIPTOR_FULL, BRAND_DESCRIPTOR_SHORT, BRAND_ICON, MARKETING_TAGLINE } from "./brand";

const root = process.cwd();
const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? sourceFiles(rel) : /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [rel] : [];
  });

describe("QuizBox brand identity", () => {
  it("uses the approved multi-level, multi-market descriptors", () => {
    expect(BRAND_DESCRIPTOR_FULL).toBe("Learning • Assessment • Competition Platform");
    expect(BRAND_DESCRIPTOR_SHORT).toBe("Learning • Assessment • Competition");
    expect(MARKETING_TAGLINE).toBe("Learn • Practice • Compete");
    for (const descriptor of [BRAND_DESCRIPTOR_FULL, BRAND_DESCRIPTOR_SHORT]) {
      expect(descriptor).not.toMatch(/\bJHS\b|Ghana|\bAI\b|Quiz Platform/i);
    }
  });

  it("never ships the retired JHS brand descriptor", () => {
    const offenders = ["app", "components", "lib"].flatMap(sourceFiles).filter((file) => /JHS Learning\s*(&|&amp;|and)\s*Assessment Platform/i.test(readFileSync(path.join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("ships the neon mark icon used by the lockup", async () => {
    const meta = await sharp(path.join(root, "public", BRAND_ICON.src)).metadata();
    expect([meta.width, meta.height]).toEqual([BRAND_ICON.width, BRAND_ICON.height]);
  });
});
