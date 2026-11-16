import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChildChoiceTable from "./ChildChoiceTable";

const rows = [{ id: "a", name: "Ama" }, { id: "b", name: "Kojo" }, { id: "c", name: "Sena", disabled: true }];
const choices = [{ value: "plan_monthly", label: "Monthly", cost: "GHS 10" }, { value: "plan_term", label: "Term", cost: "GHS 25" }];
const html = (picks: Record<string, string>) => renderToStaticMarkup(<ChildChoiceTable legend="Who" rows={rows} choices={choices} picks={picks} onChange={() => undefined} choiceLabel="Plan" />);

describe("ChildChoiceTable", () => {
  it("starts with nobody ticked, offers Select all and a same-for-everyone shortcut, and each child gets their own choice", () => {
    const h = html({});
    expect(h).toContain("Select all (2)"); expect(h).toContain("Same for everyone"); expect(h).toContain("Tick who you are buying for");
    expect(h).toContain('aria-label="Plan for Ama"'); expect(h).toContain('aria-label="Plan for Kojo"');
  });
  it("lets different children have different plans and shows the count", () => {
    const h = html({ a: "plan_monthly", b: "plan_term" });
    expect(h).toContain("2 children selected"); expect(h).toContain("Monthly · GHS 10"); expect(h).toContain("Term · GHS 25");
    expect(h).toMatch(/<option value="plan_monthly" selected/); expect(h).toMatch(/<option value="plan_term" selected/);
  });
  it("a child who may not be bought for cannot be ticked", () => { expect(html({})).toMatch(/disabled=""[^>]*\/>.*Sena|Sena[\s\S]*disabled/); });
});
