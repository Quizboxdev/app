import Link from "next/link";
import HelpFooter from "./HelpFooter";
import { categoryLabel, withoutTitleLine, type HelpDetail } from "@/lib/help/categories";
import { RenderText } from "@/lib/policies/render";

// One guide: the steps, related guides, and the feedback and support box. Pure display, so the public page (server) and the in-app page (client) both use it.
export default function HelpArticleView({ detail, inApp }: { detail: HelpDetail; inApp: boolean }) {
  const a = detail.article, base = inApp ? "/guides" : "/help", link = inApp ? "qb-link" : "qbp-link";
  return (
    <article>
      <p className={inApp ? "qb-muted qb-small" : "qbp-meta"}><Link className={link} href={base}>All guides</Link> · {categoryLabel(a.category)}</p>
      <div className={inApp ? "qb-card" : "qbp-prose"} style={inApp ? undefined : { maxWidth: 760 }}>
        <div className={inApp ? "qbp-prose" : undefined} style={{ maxWidth: 760 }}><RenderText source={withoutTitleLine(a.body)} helpBase={base} linkClass={link} /></div>
      </div>
      <div style={{ maxWidth: 760 }}><HelpFooter slug={a.slug} title={a.title} category={a.category} inApp={inApp} /></div>
      {detail.related.length > 0 && (
        <section aria-labelledby="help-related" style={{ maxWidth: 760, marginTop: 24 }}>
          <h2 id="help-related" style={{ fontSize: 18 }}>More in {categoryLabel(a.category)}</h2>
          <ul style={{ margin: 0 }}>{detail.related.map((r) => <li key={r.slug}><Link className={link} href={`${base}/${r.slug}`}>{r.title}</Link></li>)}</ul>
        </section>
      )}
    </article>
  );
}
