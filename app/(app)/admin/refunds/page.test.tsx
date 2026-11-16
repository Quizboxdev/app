import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, className }: any) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/components/admin/ExportLink", () => ({ default: () => <span>export</span> }));

import AdminRefundsPage from "./page";

// First paint of Refunds (before the database answers): heading, four figure tiles, the payment search and the cases panel.
describe("refunds screen", () => {
  const html = renderToStaticMarkup(<AdminRefundsPage />);
  it("shows the heading, figures and panels", () => {
    expect(html).toContain("Refunds");
    for (const t of ["Cases (latest 50)", "Open", "Cash refund due", "Credited as Coins"]) expect(html).toContain(t);
    expect(html).toContain("Cases");
  });
  it("offers the payment search and no large unclassed buttons", () => {
    expect(html).toContain('aria-label="Find a payment"');
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
