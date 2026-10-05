import Link from "next/link";
import type { ReactNode } from "react";
import StatusBadge from "@/components/StatusBadge";
import type { AttentionItem } from "@/lib/learning/analytics";

const LABEL = { danger: "Act", warning: "Review", info: "Note" } as const;

// "Needs attention" rows shared by Teacher and School: title, detail, urgency badge, then a link (href) or a role-specific action.
export default function AttentionList({ items, empty, labels = LABEL, renderAction }: {
  items: AttentionItem[];
  empty: { title: string; detail: string };
  labels?: Record<AttentionItem["tone"], string>;
  renderAction?: (item: AttentionItem) => ReactNode;
}) {
  if (!items.length) return <div className="qb-empty"><strong>{empty.title}</strong>{empty.detail}</div>;
  return <ul className="qb-task-list">{items.map((item) => <li key={item.key}>
    <div className="qb-row-main"><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</div>
    <StatusBadge status={item.tone} tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info"} label={labels[item.tone]} />
    {item.href ? <Link className="qb-btn secondary" href={item.href}>Open</Link> : renderAction?.(item)}
  </li>)}</ul>;
}
