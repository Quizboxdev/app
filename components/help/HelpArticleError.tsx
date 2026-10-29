"use client";

import Link from "next/link";

export default function HelpArticleError() {
  return <section className="qbp-wrap qbp-sec" data-design="canvas11-help-article-error"><div className="qbp-card" role="status"><h1 className="qbp-h2">We could not load this article</h1><p className="qbp-body">Check your connection and try again. If it keeps happening, contact support at [support email].</p><div className="qbp-actions"><button type="button" className="qbp-btn" onClick={() => window.location.reload()}>Try again</button><Link className="qbp-btn2" href="/help">Browse help centre</Link></div></div></section>;
}
