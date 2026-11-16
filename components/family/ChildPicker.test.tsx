import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChildPicker from "./ChildPicker";

const kids = [{ id: "a", name: "Ama", detail: "B8" }, { id: "b", name: "Kojo", detail: "B5" }, { id: "c", name: "Sena", disabled: true, note: "Not allowed" }];

describe("ChildPicker", () => {
  it("offers Select all for the children who can be chosen, and ticks nobody by default", () => {
    const html = renderToStaticMarkup(<ChildPicker legend="Who is it for?" options={kids} value={[]} onChange={() => undefined} />);
    expect(html).toContain("Select all (2)"); expect(html).toContain("Tick who this is for");
    expect(html).not.toContain("checked");
    expect(html).toContain("disabled");
  });
  it("shows the count and ticks the chosen ones", () => {
    const html = renderToStaticMarkup(<ChildPicker legend="Who" options={kids} value={["a", "b"]} onChange={() => undefined} />);
    expect(html).toContain("2 selected");
    expect((html.match(/checked=""/g) ?? []).length).toBe(3); // Ama, Kojo and "Select all" (every usable child is ticked)
  });
  it("has no Select all for a single child", () => {
    expect(renderToStaticMarkup(<ChildPicker legend="Who" options={[kids[0]]} value={[]} onChange={() => undefined} />)).not.toContain("Select all");
  });
});
