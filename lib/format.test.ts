import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, humanize, isUuid, shortenIds, shortId, statusTone } from "./format";

describe("display formatters", () => {
  it("shortens UUIDs and passes other values through", () => {
    expect(shortId("264e35df-3f4f-4ffd-9ae4-8545dbc8ae2f")).toBe("264e35df");
    expect(shortId("GH-CCP-2020")).toBe("GH-CCP-2020");
    expect(shortId(null)).toBe("—");
    expect(isUuid("264e35df-3f4f-4ffd-9ae4-8545dbc8ae2f")).toBe(true);
    expect(isUuid("264e35df")).toBe(false);
  });

  it("shortens UUIDs embedded in references", () => {
    expect(shortenIds("sponsor-candidate:d7e435bd-cbea-452b-9e3e-0df03f5e1629")).toBe("sponsor-candidate:d7e435bd");
    expect(shortenIds("GH-B7-001")).toBe("GH-B7-001");
  });

  it("formats timestamps without microseconds and falls back for bad input", () => {
    const text = formatDateTime("2026-10-03T08:20:38.530227+00:00");
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/530227|\+00:00|T08/);
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime(undefined, "Pending")).toBe("Pending");
  });

  it("humanizes enum values", () => {
    expect(humanize("TOP_UP_QUEUE")).toBe("Top up queue");
    expect(humanize("needs_revision")).toBe("Needs revision");
    expect(humanize("")).toBe("—");
  });

  it("maps statuses to consistent tones", () => {
    expect(statusTone("APPROVED")).toBe("success");
    expect(statusTone("final")).toBe("success");
    expect(statusTone("FAILED")).toBe("danger");
    expect(statusTone("pending_review")).toBe("warning");
    expect(statusTone("something_else")).toBe("neutral");
  });
});
