import Link from "next/link";
import HelpFooter from "./HelpFooter";
import { categoryLabel, withoutTitleLine, type HelpDetail } from "@/lib/help/categories";
import { RenderText, parseBlocks, slugOf } from "@/lib/policies/render";
import styles from "./PublicHelpArticle.module.css";

export default function PublicHelpArticle({ detail }: { detail: HelpDetail }) {
  const article = detail.article;
  const source = withoutTitleLine(article.body);
  const headings = parseBlocks(source).filter(b => b.kind === "h");
  const firstLevel = Math.min(...headings.map(h => h.level));
  const contents = headings.filter(h => h.level === firstLevel);
  return <article className={`qbp-wrap ${styles.article}`} data-design="canvas11-help-article">
    <nav aria-label="Breadcrumb" className={styles.crumb}><Link href="/help">Help centre</Link><span aria-hidden="true">/</span><span>{categoryLabel(article.category)}</span><span aria-hidden="true">/</span><span aria-current="page">{article.title}</span></nav>
    <div className={styles.layout}>
      <div className={styles.main}>
        <header className={styles.header}><p className="qbp-eyebrow">{categoryLabel(article.category)}</p><h1>{article.title}</h1><p className={styles.meta}>Updated [date]</p><p className={styles.lead}>{article.summary}</p></header>
        <div className={`qbp-prose ${styles.body}`}><RenderText source={source} helpBase="/help" linkClass="qbp-link" normalizeHeadings /></div>
        <HelpFooter slug={article.slug} title={article.title} category={article.category} inApp={false} />
      </div>
      <aside className={styles.aside} aria-label="Article navigation and support">
        {contents.length > 0 && <nav className={styles.card} aria-labelledby="help-article-contents"><h2 id="help-article-contents">On this page</h2><ul>{contents.map((h, index) => <li key={`${slugOf(h.text)}-${index}`}><a href={`#${slugOf(h.text)}`}>{h.text.replace(/\*\*/g, "")}</a></li>)}</ul></nav>}
        {detail.related.length > 0 && <section className={styles.card} aria-labelledby="help-article-related"><h2 id="help-article-related">Related articles</h2><ul>{detail.related.map(r => <li key={r.slug}><Link href={`/help/${r.slug}`}>{r.title}</Link></li>)}</ul></section>}
        <section className={styles.card}><h2>Still stuck?</h2><p>Contact support. Never send a password or PIN.</p><Link className="qbp-btn" href="/contact">Contact support</Link></section>
      </aside>
    </div>
  </article>;
}
