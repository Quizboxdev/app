import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeatureSwitchesPage from "./page";

// First paint (before the database answers): heading, the promise that nothing is deleted, and a loading placeholder.
describe("feature switches admin screen", () => {
  const html = renderToStaticMarkup(<FeatureSwitchesPage />);
  it("shows the heading and explains that switching off keeps data", () => {
    expect(html).toContain("Feature switches");
    expect(html).toContain("never deletes its data");
    expect(html).toContain('aria-busy="true"');
  });
});
