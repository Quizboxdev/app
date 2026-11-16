import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Kpi, Panel, RankedBars, Segmented, SERIES, SplitBar } from "./DataViz";

// The admin data-page pieces render the numbers, labels and hover text people rely on (the screen itself is checked by eye on Preview).
describe("admin data visualisation pieces", () => {
  it("shows a key figure with thousands separators, and flags a warning tile", () => {
    const html = renderToStaticMarkup(<Kpi label="Schools listed" value={5873} hint="16 regions" tone="warn" />);
    expect(html).toContain("5,873");
    expect(html).toContain("Schools listed");
    expect(html).toContain("is-warn");
  });
  it("draws ranked bars with a hover title and a label per mark, longest first", () => {
    const rows = [
      { key: "Greater Accra", label: "Greater Accra", segments: [{ value: 1700, color: SERIES.a, name: "Private" }, { value: 40, color: SERIES.b, name: "Public" }] },
      { key: "Volta", label: "Volta", segments: [{ value: 300, color: SERIES.a, name: "Private" }] },
    ];
    const html = renderToStaticMarkup(<RankedBars rows={rows} onPick={() => undefined} active="Volta" />);
    expect(html).toContain('title="Greater Accra: 1,740 schools (Private 1,700, Public 40)"');
    expect(html).toContain("1,740");
    expect(html).toContain('aria-pressed="true"');
    expect(html.indexOf("Greater Accra")).toBeLessThan(html.indexOf("Volta"));
    expect(html).toContain("width:100%");
  });
  it("folds extra rows behind Show all", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ key: `R${i}`, label: `Region ${i}`, segments: [{ value: 10 - i, color: SERIES.a, name: "Private" }] }));
    const html = renderToStaticMarkup(<RankedBars rows={rows} limit={8} />);
    expect(html).toContain("Region 7");
    expect(html).not.toContain("Region 8");
    expect(html).toContain("Show all 10");
  });
  it("splits one bar with direct labels and percentages, and handles an empty total", () => {
    const parts = [{ name: "Private", value: 75, color: SERIES.a }, { name: "Public", value: 25, color: SERIES.b }, { name: "Not set", value: 0, color: SERIES.none }];
    const html = renderToStaticMarkup(<SplitBar parts={parts} />);
    expect(html).toContain("75%");
    expect(html).toContain("25%");
    expect(html).toContain('aria-label="Private 75, Public 25, Not set 0"');
    expect(renderToStaticMarkup(<SplitBar parts={parts.map((p) => ({ ...p, value: 0 }))} />)).toContain("dx-split");
  });
  it("marks the selected option and shows counts", () => {
    const html = renderToStaticMarkup(<Segmented label="Status" value="approved" onChange={() => undefined} options={[{ value: "approved", label: "Approved", count: 5873 }, { value: "pending", label: "Waiting", count: 2 }]} />);
    expect(html).toContain("5,873");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
  it("gives a panel an accessible name", () => {
    expect(renderToStaticMarkup(<Panel title="Schools by region"><p>x</p></Panel>)).toContain('aria-label="Schools by region"');
  });
});
