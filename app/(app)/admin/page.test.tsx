import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminHomePage from "./page";

// First paint of the dashboard (before the database answers): the heading, the period control, the six figure tiles and the chart panels are all in place, with no large unclassed buttons.
describe("admin dashboard screen", () => {
  const html = renderToStaticMarkup(<AdminHomePage />);
  it("shows the heading, the period control and a refresh button", () => {
    expect(html).toContain("Platform dashboard");
    expect(html).toContain('aria-label="Period"');
    expect(html).toContain("30 days");
    expect(html).toContain('aria-label="Refresh"');
  });
  it("shows the figure tiles and the panels", () => {
    for (const t of ["Total users", "New users, 7 days", "Attempts, 7 days", "Live questions", "Batches to approve", "Support open"]) expect(html).toContain(t);
    for (const t of ["New accounts per day", "Learning activity per day", "Users by role", "Markets by stage", "Questions by class", "Needs attention"]) expect(html).toContain(t);
  });
  it("lists every admin area with a dash until counts arrive", () => {
    for (const t of ["Content &amp; curriculum", "Competitions", "SME &amp; payments", "Support requests open", "Schools waiting for review", "Compensation to resolve", "Payments that do not match"]) expect(html).toContain(t);
    expect(html).toContain("—");
    expect(html).not.toContain("All clear");
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
