import { describe, expect, it } from "vitest";
import { MIN_TOPUP, seatCost, shortfall, topupAmount, SEAT_TIERS } from "./seats";

describe("seat pricing helpers", () => {
  it("a bundle costs 1 Coin per player, and an upgrade pays only the difference", () => {
    expect(seatCost(50, 0)).toBe(50); expect(seatCost(50, 20)).toBe(30); expect(seatCost(20, 50)).toBe(0);
  });
  it("works out how many Coins are missing from the wallet", () => {
    expect(shortfall(30, 80)).toBe(0); expect(shortfall(30, 10)).toBe(20); expect(shortfall(30, 0)).toBe(30);
  });
  it("never offers an online payment under the 5-Coin minimum, and none when nothing is missing", () => {
    expect(topupAmount(0)).toBe(0); expect(topupAmount(-3)).toBe(0);
    expect(topupAmount(2)).toBe(MIN_TOPUP); expect(topupAmount(5)).toBe(5); expect(topupAmount(37)).toBe(37);
  });
  it("offers the agreed bundle sizes", () => {
    expect([...SEAT_TIERS]).toEqual([10, 20, 50, 100, 200, 500, 1000]);
  });
});
