"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type Notice } from "@/lib/api/platform";
import { formatDateTime, resolveLocale, t } from "@/lib/i18n";

export default function NotificationsPage() {
  const [data, setData] = useState<{ unread: number; live: Notice[]; items: Notice[] } | null>(null), [error, setError] = useState("");
  const [locale, setLocale] = useState("en");
  useEffect(() => { setLocale(resolveLocale([navigator.language])); }, []);
  const load = useCallback(async () => { try { setData(await listNotifications()); setError(""); } catch (cause) { setError((cause as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (n: Notice) => { if (!n.live && !n.read) { await markNotificationRead(n.id).catch(() => undefined); void load(); } };
  const row = (n: Notice) => <li key={n.id} className={`qb-row${n.read ? "" : " qb-unread"}`}>
    <div className="qb-row-main"><strong>{n.link ? <Link href={n.link} onClick={() => void open(n)}>{n.title}</Link> : n.title}</strong><span>{n.message}</span>
      <span className="qb-small qb-muted">{formatDateTime(n.created_at, locale)}{n.market ? ` · ${n.market}` : ""}{!n.read && !n.live ? " · Unread" : ""}</span></div>
    {!n.live && !n.read && <button className="qb-btn secondary" onClick={() => void open(n)}>Mark read</button>}
  </li>;
  return <>
    <div className="qb-page-head"><h1>{t("notifications.title", locale)}</h1>{data && data.unread > 0 && <button className="qb-btn secondary" onClick={() => void markAllNotificationsRead().then(load)}>{t("notifications.markAll", locale)}</button>}</div>
    {error && <p className="qb-error" role="alert">{error} <button className="qb-btn secondary" onClick={() => void load()}>{t("common.retry", locale)}</button></p>}
    {!data && !error && <p className="qb-muted" role="status">{t("common.loading", locale)}</p>}
    {data && data.live.length > 0 && <section className="qb-card"><h2>{t("notifications.live", locale)}</h2><ul className="qb-list">{data.live.map(row)}</ul></section>}
    {data && <section className="qb-card"><h2>Activity</h2>{data.items.length ? <ul className="qb-list">{data.items.map(row)}</ul> : <p className="qb-muted">{t("notifications.empty", locale)}</p>}</section>}
  </>;
}
