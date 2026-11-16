import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaymentChecks from "./page";

// First paint of Payment checks (before Paystack answers): heading, the six figure tiles, the look-back control and the Check now button, with no large unclassed buttons.
describe("payment checks screen", () => {
  const html = renderToStaticMarkup(<PaymentChecks />);
  it("shows the heading, the figure tiles and the controls", () => {
    expect(html).toContain("Payment checks");
    for (const t of ["Need attention", "Paid, not recorded", "Paid, not delivered", "Still in progress", "Never paid", "Open payments checked"]) expect(html).toContain(t);
    expect(html).toContain('aria-label="Look back"');
    expect(html).toContain("Check now");
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
