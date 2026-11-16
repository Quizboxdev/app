import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppSocialLinks, { ChannelIcon } from "./AppSocialLinks";
import { kindInfo, SOCIAL_KINDS } from "@/lib/api/social";

// Before the managed list loads (or while the feature is off) the menu corner shows the six built-in channels, exactly as before.
describe("app menu social links", () => {
  it("shows the six built-in channels until the managed list arrives", () => {
    const html = renderToStaticMarkup(<AppSocialLinks />);
    for (const c of ["TikTok", "Instagram", "Facebook", "YouTube", "LinkedIn", "Snapchat"]) expect(html).toContain(c);
    expect(html).toContain("qb-social-icons");
  });
  it("draws an icon for every kind staff can add", () => {
    for (const k of SOCIAL_KINDS) expect(renderToStaticMarkup(<ChannelIcon kind={k.kind} />), k.kind).toContain("<svg");
  });
  it("describes every kind with wording for the form", () => {
    expect(SOCIAL_KINDS.map((k) => k.kind)).toEqual(["whatsapp", "whatsapp_channel", "telegram", "tiktok", "instagram", "facebook", "youtube", "linkedin", "snapchat", "x", "email", "website"]);
    expect(kindInfo("whatsapp")).toMatchObject({ targetLabel: "WhatsApp number with country code" });
    for (const k of SOCIAL_KINDS) { expect(k.name.length).toBeGreaterThan(1); expect(k.placeholder.length).toBeGreaterThan(3); }
  });
});
