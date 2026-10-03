import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatNumber, resolveLocale, t } from "./index";
describe("localization foundation", () => {
  it("resolves the first valid locale from user/market candidates", () => { expect(resolveLocale([null, "en-GH"])).toBe("en-GH"); expect(resolveLocale(["not a locale!!", "en-US"])).toBe("en-US"); expect(resolveLocale([])).toBe("en"); });
  it("falls back to English strings for any English locale and interpolates", () => { expect(t("notifications.title", "en-GH")).toBe("Notifications"); expect(t("notifications.title", "en-XT")).toBe("Notifications"); expect(t("missing.key", "en-US")).toBe("missing.key"); });
  it("formats currency per market without conversion", () => {
    expect(formatCurrency(12.5, "GHS", "en-GH")).toMatch(/12\.50/); expect(formatCurrency(12.5, "GHS", "en-GH")).toMatch(/GH|₵|GHS/);
    expect(formatCurrency(12.5, "USD", "en-US")).toBe("$12.50"); expect(formatCurrency(3, "TSD", "en-XT")).toMatch(/TSD\s?3\.00/);
  });
  it("formats numbers and dates by locale", () => { expect(formatNumber(1234.56, "en-US")).toBe("1,234.6"); expect(formatNumber(null, "en-GH")).toBe("-"); expect(formatDate("2026-10-03T10:00:00Z", "en-US", "UTC")).toBe("Oct 3, 2026"); expect(formatDate("2026-10-03T10:00:00Z", "en-GH", "Africa/Accra")).toMatch(/3 Oct 2026|Oct 3, 2026/); });
});
