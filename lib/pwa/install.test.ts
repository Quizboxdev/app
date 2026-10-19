import { describe, expect, it } from "vitest";
import { installState, DISMISS_DAYS } from "./install";

const NOW = Date.UTC(2026, 9, 21);
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/130 Mobile/15E148 Safari/604.1";
const env = (over: object) => ({ standalone: false, userAgent: ANDROID, hasPrompt: false, dismissedAt: null, now: NOW, ...over });

describe("installState", () => {
  it("shows nothing once the app is installed", () => { expect(installState(env({ standalone: true, hasPrompt: true }))).toBe("installed"); });
  it("offers a real install button when the browser provides one", () => { expect(installState(env({ hasPrompt: true }))).toBe("prompt"); });
  it("explains Add to Home Screen only in Safari on iPhone", () => {
    expect(installState(env({ userAgent: IPHONE_SAFARI }))).toBe("ios");
    expect(installState(env({ userAgent: IPHONE_CHROME }))).toBe("hidden");        // other iPhone browsers cannot add to the home screen
  });
  it("stays hidden on browsers with no way to install", () => { expect(installState(env({}))).toBe("hidden"); });
  it("respects a dismissal for 30 days, then asks again", () => {
    expect(installState(env({ hasPrompt: true, dismissedAt: NOW - 5 * 864e5 }))).toBe("hidden");
    expect(installState(env({ hasPrompt: true, dismissedAt: NOW - (DISMISS_DAYS + 1) * 864e5 }))).toBe("prompt");
  });
});
