import { describe, expect, it } from "vitest";
import { enabledSocialProviders, socialRedirectUrl } from "./social";

describe("social sign-in settings", () => {
  it("shows nothing when the setting is empty or missing", () => {
    expect(enabledSocialProviders(undefined)).toEqual([]);
    expect(enabledSocialProviders("")).toEqual([]);
    expect(enabledSocialProviders(" , ")).toEqual([]);
  });
  it("lists the chosen providers in a fixed order, ignoring case, spaces, repeats and unknown names", () => {
    expect(enabledSocialProviders("linkedin, GOOGLE,google,myspace").map((p) => p.id)).toEqual(["google", "linkedin_oidc"]);
  });
  it("maps icloud to Apple and linkedin to Supabase's linkedin_oidc", () => {
    expect(enabledSocialProviders("icloud,linkedin").map((p) => p.id)).toEqual(["linkedin_oidc", "apple"]);
  });
  it("returns to the page that completes sign-in links", () => {
    expect(socialRedirectUrl("https://www.quizbox.io")).toBe("https://www.quizbox.io/auth/callback");
  });
});
