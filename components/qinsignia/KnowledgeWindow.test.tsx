import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FLAGS } from "@/lib/core/config";
import { subjectCardView } from "@/lib/learning/subject-card-state";

let flags = { ...DEFAULT_FLAGS };
vi.mock("@/components/WorkspaceProvider", () => ({ useWorkspaceFlags: () => flags }));
const { default: KnowledgeWindow } = await import("./KnowledgeWindow");

const ready = subjectCardView({ available: 24 });

describe("KnowledgeWindow", () => {
  beforeEach(() => { flags = { ...DEFAULT_FLAGS }; });

  it("shows the rights-cleared photo by default, and a subject without a photo still renders the letter-tile fallback", () => {
    const photo = renderToStaticMarkup(<KnowledgeWindow name="Mathematics" href="/practise?pick=m" view={ready} />);
    expect(photo).toContain('data-photo="ready"');
    expect(photo).toContain("mathematics-discovery-960x600.webp");
    expect(photo).toContain('href="/practise?pick=m"');
    expect(photo).toContain(">Practise");
    const tile = renderToStaticMarkup(<KnowledgeWindow name="French" href="/practise?pick=f" view={ready} />);
    expect(tile).toContain('data-photo="unavailable"');
    expect(tile).not.toContain("/brand/subjects/photos/");
    expect(tile).toContain('href="/practise?pick=f"');
  });

  it("with concept photos allowed, serves the 8:5 photo with a square mobile source, decorative alt and focal point", () => {
    flags = { ...flags, q_insignia_concept_photos: true };
    const html = renderToStaticMarkup(<KnowledgeWindow name="Mathematics" href="/x" view={ready} />);
    expect(html).toContain('data-photo="ready"');
    expect(html).toContain('media="(max-width: 760px)"');
    expect(html).toContain("mathematics-mobile-640x640.webp");
    expect(html).toContain("mathematics-discovery-960x600.jpg");
    expect(html).toContain('alt=""');
    expect(html).toContain("object-position:40% 55%");
  });

  it("uses the shipped Q mark PNG on the corner plate (never a redrawn logo)", () => {
    const html = renderToStaticMarkup(<KnowledgeWindow name="French" href="/x" view={ready} />);
    expect(html).toContain('class="qi-kw-corner"');
    expect(html).toContain('src="/brand/quizbox-icon-96.png"');
  });

  it("a selector is a toggle button with aria-pressed and no heading inside it", () => {
    const html = renderToStaticMarkup(<KnowledgeWindow variant="selector" name="Science" selected onSelect={() => undefined} view={{ ...ready, status: null }} />);
    expect(html).toMatch(/<button type="button"[^>]*aria-pressed="true"/);
    expect(html).not.toMatch(/<h\d/);
    expect(html).toContain("Selected");
  });

  it("a subject with no published questions is not a link and offers no action", () => {
    const html = renderToStaticMarkup(<KnowledgeWindow name="Science" href="/x" view={subjectCardView({ available: 0 })} />);
    expect(html).not.toContain("<a ");
    expect(html).toContain("No questions published yet");
    expect(html).not.toMatch(/Notify me/i);
  });

  it("a resumable attempt links to the stored attempt and announces real progress only", () => {
    const html = renderToStaticMarkup(<KnowledgeWindow variant="returning" name="English" href="/student/attempt/a1" view={subjectCardView({ attempt: { id: "a1", answered: 3, total: 10 } })} />);
    expect(html).toContain('href="/student/attempt/a1"');
    expect(html).toContain("Resume");
    expect(html).toContain("30% of this attempt answered.");
    expect(html).toContain("width:30%");
  });
});
