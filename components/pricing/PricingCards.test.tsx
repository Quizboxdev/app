import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PricingCards from "./PricingCards";
import type { PriceRow } from "@/lib/pricing/format";

// The public pricing page used to show "Talk to us" on every paid plan because it has no pay action; a priced plan now links to /subscribe.
const row = (over: Partial<PriceRow>): PriceRow => ({ code: "x", kind: "plan", name: "Plan", audience: "learner", description: "", includes: [], period: "month", price_minor: 1000, currency: "GHS", highlight: false, checkout_url: null, coins: 10, days: 30, ...over });
const html = (rows: PriceRow[], props: Record<string, unknown> = {}) => renderToStaticMarkup(<PricingCards rows={rows} variant="public" {...props} />);
const WEEKLY = row({ code: "weekly", name: "Weekly", price_minor: 500, coins: 5, days: 7 });

describe("PricingCards buttons", () => {
  it("a priced plan on the public page links to /subscribe", () => {
    const out = html([WEEKLY], { subscribeHref: "/subscribe" });
    expect(out).toContain('href="/subscribe"');
    expect(out).toContain(">Subscribe<");
    expect(out).not.toContain("Talk to us");
  });
  it("without a subscribe link the old behaviour is kept", () => {
    expect(html([WEEKLY])).toContain("Talk to us");
  });
  it("a plan with no price yet, or without Coins and days, does not get a Subscribe button", () => {
    expect(html([row({ price_minor: null })], { subscribeHref: "/subscribe" })).toContain("Tell me when it opens");
    expect(html([row({ coins: null, days: null })], { subscribeHref: "/subscribe" })).not.toContain(">Subscribe<");
  });
  it("free, bundle and payment-link cards keep their own buttons, and the pay action wins inside the app", () => {
    expect(html([row({ price_minor: 0, name: "Free" })], { subscribeHref: "/subscribe", registerHref: "/login?mode=register" })).toContain("Get started free");
    expect(html([row({ kind: "bundle", audience: "host", price_minor: 1000 })], { subscribeHref: "/subscribe" })).toContain("Start a quiz");
    expect(html([row({ checkout_url: "https://paystack.example/pay" })], { subscribeHref: "/subscribe" })).toContain("Pay now");
    const inApp = html([WEEKLY], { subscribeHref: "/subscribe", onPay: () => undefined, payable: () => true });
    expect(inApp).toContain("Pay with mobile money or card");
    expect(inApp).not.toContain(">Subscribe<");
  });
});
