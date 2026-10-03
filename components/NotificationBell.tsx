"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { listNotifications } from "@/lib/api/platform";

// Unread count badge; the activity center lives at /notifications. Polls gently (60s) while visible.
export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => { try { const n = await listNotifications(true); setCount(n.unread + n.live.length); } catch { /* the bell must never break navigation */ } }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => window.clearInterval(timer);
  }, [load]);
  return <Link className="qb-btn ghost qb-bell" href="/notifications" aria-label={count ? `Notifications, ${count} need attention` : "Notifications"}>
    <Bell size={18} aria-hidden/>{count > 0 && <span className="qb-badge" aria-hidden>{count > 99 ? "99+" : count}</span>}
  </Link>;
}
