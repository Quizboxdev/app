import { describe, expect, it, vi } from "vitest";
import { createResetEmailRequest, isResetEmailRateLimit, RESET_EMAIL_RATE_LIMIT, RESET_EMAIL_SENT } from "./password-reset-request";

describe("reset email request throttling (mocked, no hosted email)", () => {
  it("blocks concurrent requests and permits resend only after 60 seconds", async () => {
    let clock = 1000;
    const gate = createResetEmailRequest(() => clock);
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = gate.send(send);
    expect(await gate.send(send)).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(gate.remainingSeconds()).toBe(60);
    clock += 59_999;
    expect(await gate.send(send)).toBe(false);
    clock += 1;
    expect(await gate.send(async () => {})).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("handles 429 without automatically retrying", async () => {
    const gate = createResetEmailRequest(() => 1000);
    const error = { status: 429, code: "over_email_send_rate_limit" };
    const send = vi.fn().mockRejectedValue(error);
    await expect(gate.send(send)).rejects.toEqual(error);
    expect(await gate.send(send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(gate.remainingSeconds()).toBe(60);
    expect(isResetEmailRateLimit(error)).toBe(true);
    expect(isResetEmailRateLimit({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(RESET_EMAIL_RATE_LIMIT).toBe("Too many reset emails have been requested. Please wait before trying again.");
  });

  it("keeps ordinary failures distinct and uses the required success message", async () => {
    const gate = createResetEmailRequest();
    await expect(gate.send(async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(gate.remainingSeconds()).toBe(0);
    expect(isResetEmailRateLimit(new Error("network"))).toBe(false);
    expect(RESET_EMAIL_SENT).toBe("Reset email sent. Please check your inbox before requesting another.");
  });
});
