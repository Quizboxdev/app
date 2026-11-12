import { describe, expect, it } from "vitest";
import { SOCIAL_CHANNELS, shareLinks } from "./social";

const HOSTS: Record<string, string> = { tiktok: "www.tiktok.com", instagram: "www.instagram.com", facebook: "www.facebook.com", youtube: "www.youtube.com", linkedin: "www.linkedin.com", snapchat: "www.snapchat.com" };

describe("official channels", () => {
  it("lists the six channels from the internship brief, once each", () => {
    expect(SOCIAL_CHANNELS.map((c) => c.id).sort()).toEqual(Object.keys(HOSTS).sort());
  });
  it("points every channel at its own platform over https", () => {
    for (const c of SOCIAL_CHANNELS) { const u = new URL(c.href); expect(u.protocol).toBe("https:"); expect(u.hostname).toBe(HOSTS[c.id]); }
  });
  it("uses the addresses given in the brief", () => {
    const by = Object.fromEntries(SOCIAL_CHANNELS.map((c) => [c.id, c.href]));
    expect(by.tiktok).toBe("https://www.tiktok.com/@quizz_box");
    expect(by.instagram).toBe("https://www.instagram.com/quizz.box.solutions/");
    expect(by.facebook).toBe("https://www.facebook.com/quizbox.solutions/");
    expect(by.youtube).toBe("https://www.youtube.com/@QuizBoxsolutions");
    expect(by.linkedin).toBe("https://www.linkedin.com/company/94181986");
    expect(by.snapchat).toBe("https://www.snapchat.com/add/quizbox");
  });
});

describe("shareLinks", () => {
  const l = shareLinks("https://www.quizbox.io", "Hi there");
  it("encodes the message and the address", () => {
    expect(l.whatsapp).toBe("https://wa.me/?text=Hi%20there%20https%3A%2F%2Fwww.quizbox.io");
    expect(l.facebook).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.quizbox.io");
    expect(l.x).toContain("text=Hi%20there&url=https%3A%2F%2Fwww.quizbox.io");
    expect(l.telegram).toContain("url=https%3A%2F%2Fwww.quizbox.io");
  });
  it("keeps a plain-text message for copying", () => { expect(l.message).toBe("Hi there https://www.quizbox.io"); });
});
