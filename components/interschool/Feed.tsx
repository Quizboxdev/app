import Link from "next/link";
import { REGISTRATION, day } from "@/lib/interschool/text";
import type { PublicListing } from "@/lib/interschool/types";

// The promotional feed: inter-school competitions an administrator has listed. Shows nothing at all when there are none (or while the feature is off).
export default function InterschoolFeed({ items, surface }: { items: PublicListing[]; surface: "public" | "app" }) {
  if (!items.length) return null;
  const card = surface === "public" ? "qbp-card" : "qb-card";
  return (
    <section className={surface === "public" ? "qbp-sec" : undefined} aria-label="Inter-school competitions" data-qb-section="interschool-feed">
      <div className={surface === "public" ? "qbp-wrap" : undefined} style={{ display: "grid", gap: 12 }}>
        <h2 className={surface === "public" ? "qbp-h2" : undefined}>Inter-school competitions</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {items.map((c) => (
            <article key={c.slug} className={card} style={{ display: "grid", gap: 6, alignContent: "start", minWidth: 0 }}>
              <h3 style={{ margin: 0, overflowWrap: "anywhere" }}><Link className={surface === "public" ? "qbp-link" : "qb-link"} href={`/inter-school/${c.slug}?src=link`}>{c.title}</Link></h3>
              <p style={{ margin: 0, fontSize: 14 }}>{(c.divisions ?? []).join(", ")}{c.sponsor_name ? ` · Sponsored by ${c.sponsor_name}` : ""}</p>
              <p style={{ margin: 0, fontSize: 14 }}>{REGISTRATION[c.registration]} · Register by {day(c.registration_closes_at)}</p>
            </article>))}
        </div>
        <p><Link className={surface === "public" ? "qbp-link" : "qb-link"} href="/inter-school">All inter-school competitions</Link></p>
      </div>
    </section>
  );
}
