import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LogoImage from "@/components/challenges/LogoImage";
import Qr from "@/components/interschool/Qr";
import PrintButton from "@/components/interschool/PrintButton";
import { getPublicCompetition } from "@/lib/interschool/server";
import { campaignLink, day, levelName } from "@/lib/interschool/text";
import { SITE_URL } from "@/lib/site";

// A flyer generated from the competition's own details, laid out for one A4 page. Print it, or save it as a PDF from the print dialog.
export const revalidate = 60;
export const metadata: Metadata = { title: "Competition flyer | QuizBox", robots: { index: false, follow: false } };

export default async function FlyerPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getPublicCompetition((await params).slug);
  if (!c) notFound();
  const link = campaignLink(SITE_URL, c.slug, "QR");
  return (
    <main style={{ background: "#fff", color: "#0f172a", minHeight: "100vh", padding: 16 }}>
      <style>{`@media print { .qb-noprint { display: none !important } @page { size: A4; margin: 12mm } body { background: #fff } }`}</style>
      <div className="qb-noprint" style={{ textAlign: "center", marginBottom: 16 }}><PrintButton label="Print or save as PDF" /></div>
      <article style={{ maxWidth: 680, margin: "0 auto", border: "6px solid #2563eb", borderRadius: 16, padding: 28, textAlign: "center", display: "grid", gap: 14, justifyItems: "center" }}>
        <p style={{ fontWeight: 800, fontSize: 22, margin: 0 }}><span style={{ color: "#dc2626" }}>QUIZ</span>BOX · Inter-school competition</p>
        {c.sponsor_logo_url && <LogoImage src={c.sponsor_logo_url} alt={`${c.sponsor_name ?? "Sponsor"} logo`} width={110} height={110} style={{ objectFit: "contain" }} />}
        <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: 0 }}>{c.title}</h1>
        {c.sponsor_name && <p style={{ margin: 0, fontSize: 18 }}>Sponsored by <strong>{c.sponsor_name}</strong></p>}
        <p style={{ margin: 0, fontSize: 20 }}><strong>{c.divisions.map((d) => d.title).join(" · ")}</strong></p>
        <p style={{ margin: 0 }}>{Array.from(new Set(c.divisions.flatMap((d) => d.subjects))).join(", ")} · {Array.from(new Set(c.divisions.flatMap((d) => d.level_codes.map(levelName)))).join(", ")}</p>
        <p style={{ margin: 0, fontSize: 18 }}>Register {day(c.registration_opens_at)} to <strong>{day(c.registration_closes_at)}</strong><br />Competition {day(c.opens_at)} to {day(c.ends_at)}</p>
        {c.prizes && <p style={{ margin: 0, whiteSpace: "pre-line" }}><strong>Prizes:</strong> {c.prizes.slice(0, 300)}</p>}
        <Qr value={link} size={210} label="Scan to register" />
        <p style={{ margin: 0, fontWeight: 700 }}>Scan to register, or visit</p>
        <p style={{ margin: 0, wordBreak: "break-all" }}>{link.replace(/^https?:\/\//, "").split("?")[0]}</p>
        <p style={{ margin: 0, fontSize: 13 }}>{c.participation === "OPEN" ? "Open to verified schools." : "For invited schools."} A free QuizBox account is needed.</p>
      </article>
    </main>
  );
}
