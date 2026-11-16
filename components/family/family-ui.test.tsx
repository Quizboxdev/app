import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, className }: any) => <a href={href} className={className}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ studentId: "00000000-0000-0000-0000-000000000001" }), useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/family" }));
vi.mock("@/lib/api/markets", () => ({ getMyAccount: () => Promise.resolve({}), listSignupCountries: () => Promise.resolve([]) }));
vi.mock("@/lib/api/family", async (orig) => ({ ...(await orig<typeof import("@/lib/api/family")>()), listFamilyChildren: () => Promise.resolve([]), openFamilyWorkspace: () => Promise.resolve({ id: "x", name: "My family" }) }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }) }));

import AddChildForm from "./AddChildForm";
import InviteBox from "./InviteBox";
import LinkExistingForm from "./LinkExistingForm";
import FamilyHomePage from "../../app/(app)/family/page";
import ChildPage from "../../app/(app)/family/children/[studentId]/page";
import { joinUrl } from "@/lib/api/family";

describe("family screens", () => {
  it("the family home paints a loading state first, with no children shown until the database answers", () => {
    const html = renderToStaticMarkup(<FamilyHomePage />);
    expect(html).toContain("Loading your family workspace");
    expect(html).not.toContain("My children");
  });
  it("the child page paints a loading state first", () => {
    expect(renderToStaticMarkup(<ChildPage />)).toContain("aria-busy");
  });
  it("the add-child form asks for the child's details and the parent's confirmation, and the button waits for them", () => {
    const html = renderToStaticMarkup(<AddChildForm onAdded={() => undefined} onCancel={() => undefined} />);
    for (const t of ["First name", "Last name", "Display name (optional)", "Age", "Education level", "Class", "School (optional)", "I am this child"]) expect(html).toContain(t);
    expect(html).toMatch(/<button[^>]*disabled[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled/);
  });
  it("the link-existing form never promises to say whether an account exists", () => {
    const html = renderToStaticMarkup(<LinkExistingForm onSent={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain("They must accept");
    expect(html).not.toMatch(/not found|no account/i);
  });
  it("the invitation box shows a single-use link with copy and WhatsApp, and says it is not shown again", () => {
    const token = "a".repeat(64);
    const html = renderToStaticMarkup(<InviteBox name="Ama" token={token} username="ama.k7f2" expiresAt="2026-11-23T10:00:00Z" />);
    expect(html).toContain(`/join/${token}`);
    expect(html).toContain("Copy link"); expect(html).toContain("wa.me"); expect(html).toContain("not shown again"); expect(html).toContain("ama.k7f2");
    expect(joinUrl("https://quizbox.io/", "t")).toBe("https://quizbox.io/join/t");
  });
});
