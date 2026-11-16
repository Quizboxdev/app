import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TopicsForTeachersPage from "./page";

describe("topics for teachers screen", () => {
  const html = renderToStaticMarkup(<TopicsForTeachersPage />);
  it("shows the heading and the open-all action", () => {
    expect(html).toContain("Topics for teachers");
    expect(html).toContain("Open all 0 ready topics");
  });
  it("has no large unclassed buttons", () => {
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
