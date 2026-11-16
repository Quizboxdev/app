import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReviewerApplicationsPage from "./page";

// First paint of Reviewer applications (before the database answers): heading, six figure tiles, the three chart panels, the status control and filters, with no large unclassed buttons.
describe("reviewer applications screen", () => {
  const html = renderToStaticMarkup(<ReviewerApplicationsPage />);
  it("shows the heading, figures and chart panels", () => {
    expect(html).toContain("Reviewer applications");
    for (const t of ["Waiting for a decision", "Approved", "Declined", "Applications this week", "Typical time to decide", "All applications"]) expect(html).toContain(t);
    for (const t of ["Applications per week", "Subjects requested", "Outcome"]) expect(html).toContain(t);
  });
  it("offers the status control, the subject filter and search", () => {
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Subject"');
    expect(html).toContain("Search name, email or school");
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
