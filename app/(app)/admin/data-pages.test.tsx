import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, className }: any) => <a href={href} className={className}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/admin", useRouter: () => ({ push() {}, replace() {} }) }));
vi.mock("@/components/admin/ExportLink", () => ({ default: () => <span>export</span> }));
vi.mock("@/components/SponsorEngineFlag", () => ({ useSponsorEngine: () => false }));

import Partners from "./partners/page";
import Marketplace from "./marketplace/page";
import CurriculumSources from "./curriculum-sources/page";
import CurriculumStructure from "./curriculum-structure/page";
import Operations from "./operations/page";
import Exports from "./exports/page";
import Staff from "./staff/page";
import Access from "./access/page";
import YoungLearners from "./young-learners/page";
import ChallengeReports from "./challenge-reports/page";
import Families from "./families/page";

// First paint of each admin page converted to the analytics layout: the page shell, its heading, and no large unclassed buttons.
const pages: Array<[string, () => React.ReactElement, string[]]> = [
  ["Partner Integrations", () => <Partners />, ["Partner Integrations"]],
  ["Marketplace", () => <Marketplace />, ["Sets waiting for review", "Sellers to verify", "Overdue payouts"]],
  ["Curriculum sources", () => <CurriculumSources />, ["Sources registered", "Needs review", "Markets ready"]],
  ["Curriculum structure", () => <CurriculumStructure />, ["Curricula", "Indicators to load"]],
  ["Operations", () => <Operations />, ["Active learners, 7 days", "Failures, 7 days"]],
  ["Export data", () => <Exports />, []],
  ["Staff access", () => <Staff />, ["Staff access"]],
  ["Access and subscriptions", () => <Access />, ["Access and subscriptions"]],
  ["Young learners", () => <YoungLearners />, ["Past retention", "Automatic erasure"]],
  ["Challenge reports", () => <ChallengeReports />, ["Open reports"]],
  ["Loading families", () => <Families />, []],
];

describe("admin data pages", () => {
  for (const [name, render, texts] of pages) {
    it(`${name}: heading, figures and compact controls`, () => {
      const html = renderToStaticMarkup(render());
      expect(html).toContain(name);
      for (const t of texts) expect(html).toContain(t);
      expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
    });
  }
});
