import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

// The sign-in page for an approved partner's people (for example /partner/accra-high). It shows only the partner's name; it never lists licences, people or counts, and it is not indexed.
export const metadata: Metadata = { title: "Sign in with your school or organisation | QuizBox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  PARTNER_ACCOUNT_NOT_FOUND: "We could not find a QuizBox account for you. Ask your school or organisation to invite you, or create a QuizBox account with your school e-mail first.",
  PARTNER_MEMBER_REVOKED: "Your access through this organisation has ended. Your QuizBox account and progress are safe. Ask your organisation if you think this is a mistake.",
  PARTNER_MINOR_CONSENT_REQUIRED: "A parent or guardian needs to give consent before this account can use an organisation licence.",
  PARTNER_IDENTITY_CONFLICT: "This organisation sign-in is already linked to a different QuizBox account. Please contact support.",
  PARTNER_SSO_EXPIRED: "That sign-in took too long. Please try again.",
  PARTNER_SSO_STATE_INVALID: "That sign-in could not be checked. Please start again from this page.",
  PARTNER_SSO_DENIED: "The sign-in was cancelled or refused by your organisation.",
  PARTNER_RATE_LIMITED: "Too many attempts. Please wait a minute and try again.",
  PARTNER_PROVISION_FAILED: "We could not create your account. Please contact your organisation.",
};

export default async function PartnerEntry({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  let partner: { name: string; kind: string; sso_ready: boolean } | null = null;
  try {
    const { data } = await getSupabaseAdminClient().rpc("qb_partner_public_by_slug", { p_slug: slug });
    partner = data ?? null;
  } catch { partner = null; }
  if (!partner) notFound();
  const message = error ? (MESSAGES[error] ?? "We could not sign you in. Please try again, or contact your organisation.") : null;
  return (
    <PublicShell>
      <PageIntro crumb={partner.name} title={`Sign in with ${partner.name}`} lead="Use your school or organisation account. QuizBox never sees your password there." />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 16, maxWidth: 560 }}>
        {message && <div className="qbp-card" role="alert" style={{ borderColor: "#b91c1c" }}><p style={{ margin: 0 }}>{message}</p></div>}
        {partner.sso_ready ? (
          <a className="qbp-btn" href={`/api/partner/v1/sso/${encodeURIComponent(slug)}/start`}>Continue with {partner.name}</a>
        ) : (
          <div className="qbp-card"><p style={{ margin: 0 }}>Sign-in for {partner.name} is not switched on yet. Please check back soon or contact your organisation.</p></div>
        )}
        <p className="qbp-meta">Already have a QuizBox account? Signing in here connects it to {partner.name}, and your progress is kept. Licences are managed by your organisation and QuizBox; if a licence ends your account stays.</p>
      </section>
    </PublicShell>
  );
}
