import { describe, expect, it } from "vitest";
import { tabsFor, WORKFLOWS, workflowLabel } from "./workflows";

describe("staff workflows", () => {
  it("opens nothing for nobody and for ids it does not know", () => {
    expect(tabsFor([])).toEqual([]);
    expect(tabsFor(["payroll"])).toEqual([]);
  });

  it("lists a workflow's tabs in order", () => {
    expect(tabsFor(["support"]).map(([, label]) => label)).toEqual(["Enquiry Inbox", "Support requests", "Help guides", "Reviewer Applications", "Export data"]);
  });

  it("shows a tab shared by two workflows once", () => {
    const hrefs = tabsFor(["finance", "content", "support"]).map(([href]) => href);
    expect(hrefs.filter((h) => h === "/admin/exports")).toHaveLength(1);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("follows workflow order, not the order asked for", () => {
    expect(tabsFor(["support", "content"]).map(([href]) => href)[0]).toBe("/admin/content-factory");
  });

  it("every tab is an admin or review page, and only finance is marked sensitive", () => {
    for (const w of WORKFLOWS) for (const [href] of w.tabs) expect(href).toMatch(/^\/(admin|review)(\/|$)/);
    expect(WORKFLOWS.filter((w) => w.sensitive).map((w) => w.id)).toEqual(["finance"]);
  });

  it("names a workflow, and falls back to the id", () => {
    expect(workflowLabel("content")).toBe("Content team");
    expect(workflowLabel("x")).toBe("x");
  });
});
