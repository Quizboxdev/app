"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import BrandLockup from "@/components/BrandLockup";
import { PUBLIC_LINKS } from "./links";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/#who", label: "Who it's for" },
  { href: "/challenges", label: "Challenges" },
  { href: "/competitions", label: "Competitions" },
  { href: "/#curriculum", label: "Curriculum" },
  { href: "/pricing", label: "Pricing" },
];

export default function PublicHeader() {
  const [open, setOpen] = useState(false), [signedIn, setSignedIn] = useState(false), router = useRouter();

  // The public pages are shared and cached, so they cannot know who is looking. Ask the browser: if there is a session, offer the way back in instead of Sign in.
  useEffect(() => {
    let alive = true;
    try { getSupabaseBrowserClient().auth.getSession().then(({ data }) => { if (alive && data.session) setSignedIn(true); }).catch(() => undefined); } catch { /* signed-out look is the safe default */ }
    return () => { alive = false; };
  }, []);
  async function openWorkspace() {
    setOpen(false);
    try { const ctx = await bootstrapUser(); router.push(getHomeRouteForRole(String(ctx.role))); } catch { router.push("/login"); }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onResize = () => { if (window.innerWidth > 960) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [open]);

  return (
    <header className="qbp-header">
      <div className="qbp-wrap qbp-header-row">
        <BrandLockup variant="responsive" href="/" priority />
        <nav className="qbp-nav" aria-label="Main">
          {NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
        <div className="qbp-header-actions">
          {signedIn ? <button type="button" className="qbp-btn" onClick={openWorkspace}>Open my workspace</button> : <>
            <Link className="qbp-btn2" href={PUBLIC_LINKS.login}>Sign in</Link>
            <Link className="qbp-btn" href={PUBLIC_LINKS.register}>Get started</Link>
          </>}
        </div>
        <button type="button" className="qbp-menu-btn" aria-expanded={open} aria-controls="qbp-mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
      <div id="qbp-mobile-menu" className="qbp-drawer" hidden={!open}>
        <div className="qbp-wrap">
          <nav aria-label="Mobile">
            {NAV.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}
          </nav>
          <div className="qbp-actions">
            {signedIn ? <button type="button" className="qbp-btn" onClick={openWorkspace}>Open my workspace</button> : <>
              <Link className="qbp-btn2" href={PUBLIC_LINKS.login} onClick={() => setOpen(false)}>Sign in</Link>
              <Link className="qbp-btn" href={PUBLIC_LINKS.register} onClick={() => setOpen(false)}>Get started</Link>
            </>}
          </div>
        </div>
      </div>
    </header>
  );
}
