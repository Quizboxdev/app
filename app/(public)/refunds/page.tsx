import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";

// Refund terms as decided by the owner on 2026-10-23: 7-day window; duplicate charges are credited back as Coins; a payment that was never applied to an account is refunded in cash
// only if none of its Coins were used; requests by the contact form, answered within 3 working days. Keep this page and docs/legal/REFUND_POLICY.md in step.
export const metadata: Metadata = { title: "Refund policy | QuizBox", description: "How refunds, duplicate charges and unapplied payments are handled on QuizBox." };

export default function RefundsPage() {
  return (
    <PublicShell>
      <PageIntro crumb="Refund policy" title="Refund policy" lead="What happens if you are charged twice, or a payment does not reach your account." />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section="refunds">
        <div className="qbp-prose" style={{ maxWidth: 760 }}>
          <h2>How your payment works</h2>
          <p>QuizBox is run by QuizBox Solutions, Ghana. Payments are made in Ghana cedis (GHS) through Paystack, by mobile money or card. One Coin is worth GHS 1. Your payment becomes Coins on your account, and the Coins are used for the plan or quiz seats you chose. Paystack sends you a receipt.</p>

          <h2>The 7-day window</h2>
          <p>Ask for help within <strong>7 days</strong> of the payment. After 7 days we cannot reverse a payment.</p>

          <h2>If you were charged more than once</h2>
          <p>If the same purchase was charged more than one time, we add the extra amount to your account as <strong>Coins</strong>. The extra is not paid back in cash. For example, if you paid GHS 10 twice for one plan, the second GHS 10 is added to your account as 10 Coins.</p>
          <p>To check a duplicate we need evidence that the extra charge was not applied to your account: the Paystack receipt or reference for each charge, and a screenshot or statement from your mobile-money or bank account showing both charges.</p>

          <h2>If you paid but nothing was added to your account</h2>
          <p>First we apply the payment to your account. If we cannot apply it, we refund it in cash to the way you paid, but <strong>only if none of the Coins from that purchase have been used</strong>. We check this in your account activity log. Coins that have already been used are not refunded.</p>

          <h2>How to ask</h2>
          <ol>
            <li>Open the <Link className="qbp-link" href="/contact">contact page</Link> and choose <strong>Payment or refund</strong> as the enquiry type.</li>
            <li>Give the email on your QuizBox account, the Paystack reference, the date and the amount, and what went wrong.</li>
            <li>For a duplicate charge, include the evidence described above. If you need to send a screenshot, we will tell you how when we reply.</li>
          </ol>
          <p>We decide within <strong>3 working days</strong> and tell you by email. If a cash refund is approved, it is sent through Paystack to the way you paid. How long it takes to reach you depends on your bank or mobile-money provider.</p>

          <h2>Children&apos;s accounts</h2>
          <p>Children under 13 do not pay online. A parent, guardian or school arranges the subscription and can ask for help in the same way.</p>

          <p className="qbp-meta">This policy covers payments made to QuizBox through Paystack. Questions? <Link className="qbp-link" href="/contact">Contact us</Link>.</p>
        </div>
      </section>
    </PublicShell>
  );
}
