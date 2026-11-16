import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarketSetup from "./MarketSetup";

// First paint of Market setup (before the database answers): the header, the six figure tiles, the four chart panels and the section tabs are all in place.
describe("Market setup screen", () => {
  const html = renderToStaticMarkup(<MarketSetup />);
  it("shows the heading and a New market action", () => {
    expect(html).toContain("Market setup");
    expect(html).toContain("New market");
  });
  it("shows the key figures and the four chart panels", () => {
    for (const t of ["Active markets", "Source items to resolve", "Compensation to resolve", "Market changes waiting"]) expect(html).toContain(t);
    for (const t of ["People by market", "Question bank by market", "Launch stage", "What is blocking launch"]) expect(html).toContain(t);
  });
  it("offers the five sections as one compact control, Markets selected first", () => {
    for (const t of ["Markets", "Curricula and sources", "Country changes", "Register curriculum"]) expect(html).toContain(t);
    expect(html).toContain('aria-label="Section"');
    expect(html).toContain("Search market or country");
  });
  it("does not use the large unclassed buttons", () => {
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
