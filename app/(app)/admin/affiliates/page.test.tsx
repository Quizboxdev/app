import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminAffiliatesPage from "./page";

// First paint of Affiliates (before the database answers): heading, the six figure tiles and the section control, with no large unclassed buttons.
describe("affiliates admin screen", () => {
  const html = renderToStaticMarkup(<AdminAffiliatesPage />);
  it("shows the heading and the figure tiles", () => {
    expect(html).toContain("Affiliates");
    for (const t of ["Waiting for review", "Approved affiliates", "Owed (held + approved)", "In a payout", "Paid out", "Held back by the cap"]) expect(html).toContain(t);
  });
  it("offers the three sections as one compact control and no large unclassed buttons", () => {
    expect(html).toContain('aria-label="Affiliate sections"');
    for (const t of ["Applications", "Commissions", "Policy"]) expect(html).toContain(t);
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
