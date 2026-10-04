"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import BrandLockup from "@/components/BrandLockup";
import { PUBLIC_LINKS } from "./links";

const NAV = [
  { href: "/#who", label: "Who it's for" },
  { href: "/#sponsors", label: "Sponsors" },
  { href: "/#smes", label: "Subject experts" },
  { href: "/#governance", label: "Governance" },
  { href: "/#competitions", label: "Competitions" },
  { href: "/#curriculum", label: "Curriculum" },
];

export default function PublicHeader() {
  const [open, setOpen] = useState(false);

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
          <Link className="qbp-btn2" href={PUBLIC_LINKS.login}>Sign in</Link>
          <Link className="qbp-btn" href={PUBLIC_LINKS.register}>Get started</Link>
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
            <Link className="qbp-btn2" href={PUBLIC_LINKS.login} onClick={() => setOpen(false)}>Sign in</Link>
            <Link className="qbp-btn" href={PUBLIC_LINKS.register} onClick={() => setOpen(false)}>Get started</Link>
          </div>
        </div>
      </div>
    </header>
  );
}
