import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeSponsorLogo, optimizeSubjectImagePair, SUBJECT_IMAGE_VARIANTS, SPONSOR_LOGO_VARIANT } from "./brand-images";

describe("brand image optimization", () => {
  it("makes bounded discovery/mobile WebP variants using the selected focal point", async () => {
    const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#3276a8" } }).jpeg().toBuffer();
    const result = await optimizeSubjectImagePair(source, "image/jpeg", { x: 70, y: 30 });
    expect(result.discovery).toMatchObject({ width: 960, height: 600, mime: "image/webp" });
    expect(result.mobile).toMatchObject({ width: 640, height: 640, mime: "image/webp" });
    expect(result.discovery.bytes.byteLength).toBeLessThanOrEqual(SUBJECT_IMAGE_VARIANTS.discovery.maxBytes);
    expect(result.mobile.bytes.byteLength).toBeLessThanOrEqual(SUBJECT_IMAGE_VARIANTS.mobile.maxBytes);
  });

  it("keeps a transparent sponsor logo compact and rejects unsafe image types and focal points", async () => {
    const source = await sharp({ create: { width: 900, height: 420, channels: 4, background: { r: 30, g: 130, b: 95, alpha: 0.7 } } }).png().toBuffer();
    const result = await optimizeSponsorLogo(source, "image/png");
    expect(result.mime).toBe("image/webp");
    expect(result.width).toBeLessThanOrEqual(SPONSOR_LOGO_VARIANT.width);
    expect(result.height).toBeLessThanOrEqual(SPONSOR_LOGO_VARIANT.height);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(SPONSOR_LOGO_VARIANT.maxBytes);
    expect((await sharp(result.bytes).metadata()).hasAlpha).toBe(true);
    await expect(optimizeSponsorLogo(source, "image/svg+xml")).rejects.toThrow("INVALID_IMAGE");
    await expect(optimizeSubjectImagePair(source, "image/png", { x: 101, y: 50 })).rejects.toThrow("INVALID_IMAGE");
  });
});
