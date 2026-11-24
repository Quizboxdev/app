import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HeroSection from "./HeroSection";
import FaqSection from "./FaqSection";
import StakeholderTabs, { AUDIENCES } from "./StakeholderTabs";
import SponsorSection, { SPONSOR_STAGES } from "./SponsorSection";
import ParentsPage from "@/app/(public)/parents/page";
import { PUBLIC_PATHS } from "@/lib/site";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

describe("home page hero", () => {
  const html = renderToStaticMarkup(<HeroSection />);
  it("leads with the new headline, four trust points and a way in for students, parents, teachers and sponsors", () => {
    expect(html).toContain("verified academic mastery.");
    for (const t of ["Built from GES / NaCCA approved curriculum documents", "Reviewed by subject experts before use", "Works in any phone browser, nothing to install", "Automatic marking with instant feedback"]) expect(html).toContain(t);
    expect(html).toContain('href="/parents"');
    expect(html).toContain("sponsor a school challenge");
  });
  it("makes no unproven claim", () => {
    expect(html).not.toMatch(/100%|accredited|\bMB\b|hours/i);
  });
});

describe("audience tabs", () => {
  const html = renderToStaticMarkup(<StakeholderTabs />);
  it("has five tabs, the first selected, each with its own panel and call to action", () => {
    expect(AUDIENCES).toHaveLength(5);
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(5);
    expect(html).toMatch(/id="loop-tab-students"[^>]*aria-selected="true"/);
    expect(html).toContain('href="/parents"');
  });
});

describe("FAQ section", () => {
  it("renders every home question as an accordion with structured data", () => {
    const html = renderToStaticMarkup(<FaqSection where="home" />);
    expect(html).toContain("How do we know the questions match the real syllabus?");
    expect(html).toContain("application/ld+json");
    expect(html).not.toContain("<script>alert");
  });
});

describe("sponsor stages", () => {
  it("group the 14 steps into four stages and keep the prize disclaimer", () => {
    expect(SPONSOR_STAGES).toHaveLength(4);
    expect(SPONSOR_STAGES.reduce((n, s) => n + s.steps.length, 0)).toBe(14);
    const html = renderToStaticMarkup(<SponsorSection />);
    expect(html).toContain("Sponsor a verified academic competition in four stages");
    expect(html).toContain("Prizes are provided by the sponsor, not guaranteed by QuizBox");
  });
});

describe("parents page", () => {
  const html = renderToStaticMarkup(<ParentsPage />);
  it("explains the routine, the family space and sign-up as a sponsor-parent", () => {
    expect(html).toContain("school progress.");
    for (const t of ["1 · Agree the reward", "2 · Sit down for a short sprint", "3 · Look at the result together"]) expect(html).toContain(t);
    expect(html).toContain("Sponsor, parent or organization");
    expect(html).toContain("Create your family space");
    expect(html).toContain("they do not pay online");
  });
  it("makes no unproven claim and invents no plan names or prices", () => {
    expect(html).not.toMatch(/GHS|Scholar Pass|Exam Mastery|100%|accredited|\bMB\b/i);
  });
  it("is reachable from the main menu", () => {
    expect(html).toContain('>Parents</a>');
  });
  it("is in the public paths so it is in the sitemap", () => {
    expect(PUBLIC_PATHS).toContain("/parents");
  });
});

describe("teachers, schools and sponsors pages", () => {
  const pages = [
    { name: "teachers", mod: () => import("@/app/(public)/teachers/page"), has: ["Assign in minutes.", "Create a teacher account", "Automatic marking", "Class mastery"] },
    { name: "schools", mod: () => import("@/app/(public)/schools/page"), has: ["Register school interest", "Institutional access is set up by QuizBox after review", "One school profile"] },
    { name: "sponsors", mod: () => import("@/app/(public)/sponsors/page"), has: ["Create a sponsor account", "Registration is not approval", "Why a QuizBox challenge", "not guaranteed by QuizBox"] },
  ];
  for (const p of pages) {
    it(`${p.name}: renders its hero, benefits, steps and questions, with no unproven claim`, async () => {
      const Page = (await p.mod()).default;
      const html = renderToStaticMarkup(<Page />);
      for (const t of p.has) expect(html).toContain(t);
      expect(html).toContain("application/ld+json");
      expect(html).not.toMatch(/GHS|100%|accredited|\bMB\b|hours saved|Scholar Pass/i);
      expect(html.match(/<h1/g)).toHaveLength(1);
    });
  }
  it("are in the main menu, the home tabs and the sitemap paths", () => {
    const tabs = renderToStaticMarkup(<StakeholderTabs />);
    for (const path of ["/teachers", "/schools", "/sponsors"]) {
      expect(PUBLIC_PATHS).toContain(path);
      expect(tabs).toContain(`href="${path}"`);
    }
    const header = renderToStaticMarkup(<HeroSection />);
    expect(header).toContain('href="/teachers"');
    expect(header).toContain('href="/sponsors"');
  });
});
