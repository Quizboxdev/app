import type { ReactNode } from "react";

// Policy and help text is plain text with a little formatting, so an owner can type it, paste it or convert it from a Word file:
//   # Heading, ## Subheading, ### Small heading     - or * for a bullet     1. for a numbered step     **bold**     [words](https://link)
// A blank line starts a new paragraph. Everything is built as React elements, never as HTML, so nothing typed here can run as code. Links may only be https, http, mailto or a path on this site.
export type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const out: Block[] = [], lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [], list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { out.push({ kind: "p", text: para.join(" ") }); para = []; } };
  const flushList = () => { if (list) { out.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line), ul = /^[-*]\s+(.+)$/.exec(line), ol = /^\d+[.)]\s+(.+)$/.exec(line);
    if (h) { flushPara(); flushList(); out.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] }); }
    else if (ul) { flushPara(); if (list?.kind !== "ul") { flushList(); list = { kind: "ul", items: [] }; } list!.items.push(ul[1]); }
    else if (ol) { flushPara(); if (list?.kind !== "ol") { flushList(); list = { kind: "ol", items: [] }; } list!.items.push(ol[1]); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out;
}

const SAFE_LINK = /^(https?:\/\/|mailto:|help:[a-z0-9-]+$|\/(?!\/))/i;
export type LinkOptions = { helpBase?: string; linkClass?: string };
export function inline(text: string, keyBase = "i", opts: LinkOptions = {}): ReactNode[] {
  const nodes: ReactNode[] = [], re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyBase}${n++}`}>{m[1]}</strong>);
    else if (SAFE_LINK.test(m[3])) {
      const external = /^https?:/i.test(m[3]), href = m[3].startsWith("help:") ? `${opts.helpBase ?? "/help"}/${m[3].slice(5)}` : m[3];   // help:slug points at another guide
      nodes.push(<a key={`${keyBase}${n++}`} className={opts.linkClass ?? "qbp-link"} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{m[2]}</a>);
    }
    else nodes.push(m[2]);                                   // an unsafe address is shown as plain words, not as a link
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const slugOf = (text: string) => text.toLowerCase().replace(/\*\*|\[|\]\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const headingsOf = (source: string) => parseBlocks(source).filter((b): b is Extract<Block, { kind: "h" }> => b.kind === "h" && b.level === 2).map((b) => ({ text: b.text.replace(/\*\*/g, ""), id: slugOf(b.text) }));

// normalizeHeadings: the smallest heading level in the text becomes h2 (right under the page's h1), the next h3, and so on. Help guides are typed with ## for their
// sections, which would otherwise skip a level (h1 then h3) and fail WCAG heading order (audit UX-007).
export function RenderText({ source, helpBase, linkClass, normalizeHeadings }: { source: string; normalizeHeadings?: boolean } & LinkOptions) {
  const opts = { helpBase, linkClass };
  const blocks = parseBlocks(source);
  const smallest = Math.min(...blocks.flatMap((b) => (b.kind === "h" ? [b.level] : [])), 3);
  const tagLevel = (level: number) => (normalizeHeadings ? level - smallest + 2 : level + 1);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "h") { const Tag = (`h${tagLevel(b.level)}` as "h2" | "h3" | "h4"); return <Tag key={i} id={slugOf(b.text)}>{inline(b.text, `h${i}`, opts)}</Tag>; }   // the page title is the h1, so # becomes h2
        if (b.kind === "ul") return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `u${i}${j}`, opts)}</li>)}</ul>;
        if (b.kind === "ol") return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `o${i}${j}`, opts)}</li>)}</ol>;
        return <p key={i}>{inline(b.text, `p${i}`, opts)}</p>;
      })}
    </>
  );
}
