import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTicketsPage from "./page";

// First paint of Support requests (before the database answers): heading, six figure tiles, the two chart panels, the status control and filters.
describe("support requests screen", () => {
  const html = renderToStaticMarkup(<AdminTicketsPage />);
  it("shows the heading, figures and panels", () => {
    expect(html).toContain("Support requests");
    for (const t of ["Open", "High priority open", "Waiting for the person", "Resolved or closed", "Opened this week", "In the queue"]) expect(html).toContain(t);
    for (const t of ["Requests opened per day", "What people ask about"]) expect(html).toContain(t);
  });
  it("offers the status control, filters and search, and no large unclassed buttons", () => {
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Priority"');
    expect(html).toContain("Search reference, subject or person");
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
