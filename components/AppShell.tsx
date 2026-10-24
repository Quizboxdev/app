"use client";

import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";
import GlobalSearch from "@/components/GlobalSearch";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, X, Home, BookOpen, Dumbbell, FileText, BarChart3, Bell, Users, Trophy, ShoppingBag, Globe, ShieldCheck, Layers, LifeBuoy, Settings, CircleUser, CircleHelp, LogOut, type LucideIcon } from "lucide-react";
import { bootstrapUser, getHomeRouteForRole, signOut } from "@/lib/auth";
import type { UserContext } from "@/lib/types";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";
import MarketContextControl from "@/components/MarketContextControl";
import BrandLockup from "@/components/BrandLockup";
import WorkspaceProvider from "@/components/WorkspaceProvider";
import { loginHrefFor } from "@/lib/auth/next-path";
import WorkspaceChip from "@/components/WorkspaceChip";
import { SponsorEngineProvider } from "@/components/SponsorEngineFlag";
import DraftReminder from "@/components/DraftReminder";
import PolicyGate from "@/components/policies/PolicyGate";
import HelpStarter from "@/components/help/HelpStarter";
import SponsoredCarousel from "@/components/challenges/SponsoredCarousel";
import ConnectionBanner from "@/components/ConnectionBanner";

type NavItem = [string, string];
type NavGroup = { label: string; items: NavItem[] };

function navigationIcon(href: string): LucideIcon {
  if (/^\/practise/.test(href)) return Dumbbell;
  if (/^\/learn/.test(href)) return BookOpen;
  if (/student\/results/.test(href)) return BarChart3;
  if (/notifications/.test(href)) return Bell;
  if (/^\/account/.test(href)) return CircleUser;
  if (/student\/classroom/.test(href)) return FileText;
  if (/competition|creator|challenges|open/.test(href)) return Trophy;
  if (/marketplace|seller/.test(href)) return ShoppingBag;
  if (/classes|classroom|tenants|school/.test(href)) return Users;
  if (/markets|market-setup/.test(href)) return Globe;
  if (/question-banks|curriculum|content/.test(href)) return BookOpen;
  if (/assignments|assessments|gradebook|results/.test(href)) return FileText;
  if (/review|quality/.test(href)) return ShieldCheck;
  if (/support/.test(href)) return LifeBuoy;
  if (/operations|compensation|payout/.test(href)) return Settings;
  if (/workspace/.test(href)) return Layers;
  return Home;
}

export default function AppShell({
  children,
  sponsorEngine = false,
}: {
  children: React.ReactNode;
  sponsorEngine?: boolean;
}) {
  const [ctx, setCtx] = useState<UserContext | null>(null);
  const [sme, setSme] = useState<SmeContext | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    bootstrapUser()
      .then(async (context) => {
        setCtx(context);
        // An unapplied foundation migration must not disrupt existing role access.
        try { setSme(await getSmeContext()); } catch { setSme(null); }
      })
      .catch((error) => router.replace(error instanceof Error && error.message === "ONBOARDING_REQUIRED" ? "/onboarding" : error instanceof Error && error.message === "ACCOUNT_SUSPENDED" ? "/login?suspended=1" : loginHrefFor(window.location.pathname)));
  }, [router]);

  useEffect(() => {
    if (!ctx) return;

    const role = String(ctx.role).toUpperCase();
    const allowedPrefixes = ["ADMIN", "OWNER"].includes(role)
      ? ["/admin", "/teacher", "/practise", "/student/attempt", "/competition", "/marketplace", "/subscribe", "/creator"]
      : role === "TEACHER"
        ? ["/teacher", "/practise", "/student/attempt", "/competition", "/marketplace", "/seller", "/subscribe", "/creator"]
        : role === "SPONSOR"
          ? ["/sponsor", "/competition", "/marketplace", "/creator"]
          : ["/student", "/learn", "/practise", "/competition", "/marketplace", "/subscribe", "/creator"];

    allowedPrefixes.push("/account", "/notifications", "/school", "/play", "/open", "/drafts", "/support", "/guides");
    if (sme?.reviewer || sme?.content_admin || sme?.super_admin) allowedPrefixes.push("/review");
    if (sme?.super_admin) allowedPrefixes.push("/admin/markets", "/admin/reviewers", "/admin/compensation", "/admin/policies");
    if (sme?.super_admin || sme?.sme_support) allowedPrefixes.push("/admin/inbox", "/admin/reviewer-applications", "/admin/tickets", "/admin/help");
    if (sme?.super_admin || sme?.finance_admin) allowedPrefixes.push("/admin/sme-performance", "/admin/payouts", "/admin/payment-checks");
    if (sme?.super_admin || sme?.finance_admin || sme?.content_admin || sme?.sme_support) allowedPrefixes.push("/admin/exports");

    const isAllowed = allowedPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

    if (!isAllowed) {
      router.replace(getHomeRouteForRole(role));
    }
  }, [ctx, pathname, router, sme]);

  const inSchool = pathname.startsWith("/school");
  const groups = useMemo<NavGroup[]>(() => {
    if (!ctx) return [];

    const role = String(ctx.role).toUpperCase();
    const isAdmin = ["ADMIN", "OWNER"].includes(role);
    const reviewer = Boolean(sme?.reviewer || sme?.content_admin || sme?.super_admin);
    const seller: NavItem[] = role === "TEACHER" ? [["/seller", "Sell question sets"]] : [];
    const when = (condition: unknown, items: NavItem[]): NavItem[] => (condition ? items : []);
    const groups: NavGroup[] = [];
    const add = (label: string, items: NavItem[]) => { if (items.length) groups.push({ label, items }); };
    // Non-admin accounts can still hold SME super-admin or finance duties.
    const administration: NavItem[] = [
      ...when(sme?.super_admin, [["/admin/markets", "Markets"], ["/admin/curriculum-sources", "Curriculum Sources"], ["/admin/reviewers", "Reviewers"], ["/admin/compensation", "Compensation"], ["/admin/policies", "Policies"], ["/admin/tickets", "Support requests"], ["/admin/help", "Help guides"]]),
      ...when(sme?.super_admin || sme?.finance_admin, [["/admin/sme-performance", "SME Performance"], ["/admin/payouts", "Payouts"], ["/admin/payment-checks", "Payment checks"]]),
      ...when(sme?.super_admin || sme?.finance_admin || sme?.content_admin || sme?.sme_support, [["/admin/exports", "Export data"]]),
      ...when(sme?.sme_support && !sme?.super_admin, [["/admin/inbox", "Enquiry Inbox"], ["/admin/tickets", "Support requests"], ["/admin/help", "Help guides"], ["/admin/reviewer-applications", "Reviewer Applications"]]),
    ];

    if (inSchool) {
      add("School", [["/school", "Overview"], ["/school/classes", "Classes"], ["/school/teachers", "Teachers"], ["/school/learners", "Learners"], ["/school/performance", "Performance"], ["/creator", "Challenges"], ["/creator?format=competition", "Competitions"]]);
      return groups;
    }

    if (isAdmin) {
      add("Overview", [["/admin", "Dashboard"], ["/drafts", "Unfinished work"]]);
      add("Markets & organizations", [
        ...when(sme?.super_admin, [["/admin/markets", "Markets"]]),
        ["/admin/market-setup", "Market Setup"],
      ]);
      add("Content & curriculum", [
        ["/admin/content", "Content Operations"],
        ...when(sme?.super_admin || sme?.content_admin, [["/admin/content-factory", "Content Factory"]]),
        ...when(sme?.super_admin, [["/admin/curriculum-sources", "Curriculum Sources"], ["/admin/curriculum-structure", "Curriculum Structure"]]),
        ...when(sme?.super_admin || sme?.content_admin, [["/admin/question-loading", "Load Questions"]]),
        ...when(sme?.super_admin, [["/admin/question-batches", "Approve Batches"]]),
        ["/admin/quality", "Content Quality"],
        ["/admin/marketplace", "Marketplace Governance"],
      ]);
      add("Competitions", [
        ["/creator", "Challenges"],
        ["/admin/challenge-reports", "Challenge Reports"],
        ["/admin/competitions", "Competition Operations"],
        ...when(sponsorEngine, [["/admin/competitions/assignments", "Assignments"], ["/admin/competitions/oversight", "Oversight"]]),
      ]);
      add("SME & payments", [
        ...when(reviewer, [["/review", "SME Reviews"]]),
        ...when(reviewer || sme?.content_admin || sme?.super_admin, [["/review/policy", "Reviewer Policy"]]),
        ...when(sme?.super_admin, [["/admin/reviewers", "Reviewers"]]),
        ...when(sme?.super_admin || sme?.sme_support, [["/admin/reviewer-applications", "Reviewer Applications"]]),
        ...when(sme?.super_admin || sme?.finance_admin, [["/admin/sme-performance", "SME Performance"]]),
        ...when(sme?.super_admin || sme?.content_admin, [["/admin/sme-workforce", "SME Workforce"]]),
        ...when(sme?.super_admin, [["/admin/compensation", "Compensation"]]),
        ...when(sme?.super_admin || sme?.finance_admin, [["/admin/payouts", "Payouts"]]),
      ]);
      add("Operations", [
        ["/admin/operations", "Platform Operations"],
        ["/admin/support", "Support"],
        ...when(sme?.super_admin || sme?.sme_support, [["/admin/inbox", "Enquiry Inbox"]]),
        ...when(sme?.super_admin, [["/admin/young-learners", "Young learners (privacy)"]]),
        ...when(sme?.super_admin, [["/admin/access", "Access & Subscriptions"]]),
        ["/admin/pricing", "Prices"],
        ["/admin/tickets", "Support requests"],
        ["/admin/help", "Help guides"],
        ["/admin/refunds", "Refunds"],
        ["/admin/policies", "Policies"],
        ["/admin/exports", "Export data"],
        ...when(sme?.super_admin || sme?.finance_admin, [["/admin/payment-checks", "Payment checks"]]),
      ]);
      add("Marketplace", [["/marketplace", "Catalogue"], ["/marketplace/mine", "My question sets"]]);
      return groups;
    }

    if (role === "SPONSOR") {
      add("", [
        ["/sponsor", "Dashboard"],
        ["/drafts", "Unfinished work"],
        ...when(sponsorEngine, [["/sponsor/workspace", "Workspace"]]),
        ["/creator", "Challenges"],
        ["/competition", "Competitions"],
        ["/marketplace", "Marketplace"],
      ]);
      add("SME", when(reviewer, [["/review", "SME Reviews"]]));
      add("Administration", administration);
      return groups;
    }

    if (role === "TEACHER") {
      add("Teaching", [
        ["/teacher", "Dashboard"],
        ["/drafts", "Unfinished work"],
        ["/teacher/classes", "Classes"],
        ["/teacher/learners", "Young learners"],
        ["/teacher/assignments", "Assignments"],
        ["/teacher/gradebook", "Gradebook"],
        ["/teacher/question-banks", "Question Banks"],
        ["/practise", "Practise questions"],
      ]);
      add("Explore", [["/creator", "Challenges"], ["/open", "Open to join"], ["/competition", "Competitions"], ["/marketplace", "Marketplace"], ...seller]);
      add("SME", when(reviewer, [["/review", "SME Reviews"]]));
      add("Administration", administration);
      return groups;
    }

    // Learn → Practise → Assignments (delivery, not a mode) → Compete; secondary destinations follow.
    add("", [
      ["/student", "Home"],
      ["/practise", "Practise"],
      ["/student/classroom", "Assignments"],
      ["/competition", "Compete"],
      ["/open", "Challenges"],
      ["/play", "My challenges"],
      ["/creator", "Create and share"],
    ]);
    add("My learning", [
      ["/student/results", "Progress"],
      ["/student/assessments", "Assessments"],
      ["/marketplace", "Marketplace"],
      ["/marketplace/mine", "My question sets"],
    ]);
    add("Me", [["/notifications", "Notifications"], ["/drafts", "Unfinished work"], ["/subscribe", "Subscribe"], ["/account", "Account"]]);
    add("SME", when(reviewer, [["/review", "SME Reviews"]]));
    add("Administration", administration);
    return groups;
  }, [ctx, inSchool, sme, sponsorEngine]);

  const nav = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // The most specific matching link is the current page (so /admin is not active on /admin/content).
  const activeHref = useMemo(
    () => nav.map(([href]) => href).filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0],
    [nav, pathname]
  );

  // The tab title follows the page (audit UX-003): pages here are client components and cannot export metadata.
  const docTitle = useMemo(() => {
    const label = nav.find(([href]) => href === activeHref)?.[1];
    return label ? `${label} | QuizBox` : "QuizBox";
  }, [nav, activeHref]);
  useEffect(() => { document.title = docTitle; }, [docTitle]);

  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [moreOpen]);

  // Phones show tables as record cards; each cell is labelled with its column header.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    const label = () => {
      frame = 0;
      root.querySelectorAll<HTMLElement>(".qb-table-wrap").forEach((wrap) => {
        if (wrap.scrollWidth > wrap.clientWidth + 1) {
          if (!wrap.hasAttribute("tabindex")) { wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "Scrollable table"); }
        } else if (wrap.getAttribute("aria-label") === "Scrollable table") { wrap.removeAttribute("tabindex"); wrap.removeAttribute("role"); wrap.removeAttribute("aria-label"); }
      });
      root.querySelectorAll("table").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
        if (!headers.length) return;
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            if (cell.tagName === "TD" && !cell.hasAttribute("data-label") && headers[index]) cell.setAttribute("data-label", headers[index]);
          });
        });
      });
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(label); });
    observer.observe(root, { childList: true, subtree: true });
    label();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [ctx]);

  if (!ctx) {
    return <div className="qb-boot" role="status" aria-live="polite"><BrandLockup variant="mark" size={36} /><span>Loading your workspace…</span></div>;
  }

  const role = String(ctx.role).toUpperCase();
  const name =
    String((ctx.profile as any).full_name ?? "") ||
    String((ctx.profile as any).email ?? "QuizBox User");
  const navLinks = (items: NavItem[]) => items.map(([href, label]) => {
    const Icon = navigationIcon(href);
    return <Link key={href} href={href} aria-current={href === activeHref ? "page" : undefined}>
      <Icon size={18} aria-hidden="true" /><span>{label}</span>
    </Link>;
  });
  const navGroups = groups.map((group, index) => (
    <div key={group.label || index} role="group" aria-label={group.label || undefined}>
      {group.label && <div className="qb-nav-group" aria-hidden="true">{group.label}</div>}
      {navLinks(group.items)}
    </div>
  ));
  // Role accent (design system): drives --role for the eyebrow, workspace label, avatar ring and hero rule.
  const roleKey = pathname.startsWith("/review") ? "sme" : pathname.startsWith("/school") ? "school"
    : ["ADMIN", "OWNER"].includes(role) ? "admin" : role === "TEACHER" ? "teacher" : role === "SPONSOR" ? "sponsor" : "student";
  // Phones get four primary destinations plus "More", which opens the full navigation.
  const primary = nav.slice(0, roleKey === "student" ? 5 : 4);
  const activeLabel = nav.find(([href]) => href === activeHref)?.[1];
  const pageTitle = pathname === "/review" ? "SME Dashboard"
    : pathname === "/school" ? "School Dashboard"
      : activeLabel === "Home" && roleKey === "student" ? "Home"
        : activeLabel === "Home" || activeLabel === "Dashboard" ? `${role.charAt(0)}${role.slice(1).toLowerCase()} Dashboard`
        : activeLabel ?? "QuizBox";
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <div className="qb-shell" data-role={roleKey}>
      <a href="#qb-main" className="qb-skip">Skip to main content</a>
      <aside className="qb-sidebar">
        <div className="qb-brand">
          <BrandLockup variant="compact" size={32} />
        </div>
        <div className="qb-workspace-label">{pathname.startsWith("/review") ? "SME" : pathname.startsWith("/school") ? "School" : role.toLowerCase()} workspace</div>

        <nav className="qb-nav" aria-label="Main">
          {navGroups}
        </nav>
        {["STUDENT", "TEACHER"].includes(String(ctx?.role ?? "").toUpperCase()) && !inSchool && <div className="qb-sidebar-sponsor" style={{ padding: "0 12px 12px" }}><SponsoredCarousel compact showLibrary={false} /></div>}
      </aside>

      <main className="qb-main" id="qb-main" tabIndex={-1}>
        <header className="qb-topbar">
          <BrandLockup variant="mark" size={28} href={getHomeRouteForRole(role)} className="qb-topbar-brand" />
          <strong className="qb-topbar-title">{pageTitle}</strong>
          <GlobalSearch/>
          <NotificationBell/>

          <div className="qb-topbar-user">
            <Link className="qb-avatar" href="/account" aria-label="Your profile" title="Your profile">{initials}</Link>
            <div className="qb-topbar-who">
              <strong>{name}</strong>
              <span className="qb-muted">{role}</span>
            </div>
            <Link className="qb-btn secondary" href="/guides" aria-label="Help" title="Help"><CircleHelp size={16} aria-hidden="true" /><span className="qb-signout-label">Help</span></Link>
            <Link className="qb-btn secondary" href="/support" aria-label="Support" title="Support"><LifeBuoy size={16} aria-hidden="true" /><span className="qb-signout-label">Support</span></Link>
            <Link className="qb-btn secondary qb-account-link" href="/account"><CircleUser size={16} aria-hidden="true" />Account</Link>
            <button
              className="qb-btn ghost"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              <LogOut size={16} aria-hidden="true" /><span className="qb-signout-label">Sign out</span>
            </button>
          </div>
        </header>
        <ConnectionBanner />

        <div className="qb-content" ref={contentRef}>
          <SponsorEngineProvider value={sponsorEngine}><WorkspaceProvider>
            <div className="qb-context-bar"><WorkspaceChip/><MarketContextControl/></div>
            <DraftReminder />
            <HelpStarter pathname={pathname} />
            <PolicyGate>{children}</PolicyGate>
          </WorkspaceProvider></SponsorEngineProvider>
        </div>

        <nav className="qb-mobile-nav" aria-label="Main" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {navLinks(primary)}
          <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
            <LayoutGrid size={18} aria-hidden="true" />More
          </button>
        </nav>

        {moreOpen && (
          <div className="qb-more-sheet" onClick={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}>
            <div className="qb-more-panel" role="dialog" aria-modal="true" aria-label="All sections">
              <div className="qb-more-head">
                <span>All sections</span>
                <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)} autoFocus><X size={18} aria-hidden="true" /></button>
              </div>
              <nav className="qb-nav" aria-label="All sections">{navGroups}</nav>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
