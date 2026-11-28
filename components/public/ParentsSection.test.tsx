import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ParentsSection from "./ParentsSection";
import RoleEcosystem from "./RoleEcosystem";

// The parents block on the public home page: it is reachable from the role list, explains the family workspace, and links to the parent guide.
describe("ParentsSection", () => {
  const html = renderToStaticMarkup(<ParentsSection />);

  it("has an anchor the role list can jump to, and a heading", () => {
    expect(html).toContain('id="parents"');
    expect(html).toContain("One family space for your children&#x27;s learning");
  });

  it("names the four things the family workspace does", () => {
    for (const title of ["One workspace for every child", "Follow their progress", "Give practice and challenges", "Pay once for the family"]) {
      expect(html).toContain(title);
    }
  });

  it("links to the parent guide and to sign-up", () => {
    expect(html).toContain('href="/help/parents-and-family-workspace"');
    expect(html).toContain("Sign up as a parent or guardian");
    expect(html).toContain("Choose Parent or guardian");
    expect(html).toContain('href="/login?mode=register&amp;role=parent"');
  });

  it("states the under-13 protections in the same terms the product uses", () => {
    expect(html).not.toContain("no public leaderboards"); // not proved in the product (guide audit 2026-11-20), so it is not promised
    expect(html).toContain("do not pay online");
  });

  it("is listed in the role section with a link to the parents block", () => {
    expect(renderToStaticMarkup(<RoleEcosystem showParents />)).toContain('href="#parents"');
  });

  it("the role list drops the parents card when the parents section is hidden, so no card points at a block that is not on the page", () => {
    expect(renderToStaticMarkup(<RoleEcosystem showParents={false} />)).not.toContain('href="#parents"');
  });
});
