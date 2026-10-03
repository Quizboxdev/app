"use client";

import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";
import GlobalSearch from "@/components/GlobalSearch";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { bootstrapUser, getHomeRouteForRole, signOut } from "@/lib/auth";
import type { UserContext } from "@/lib/types";
import { findMySeller } from "@/lib/api/marketplace";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";
import MarketContextControl from "@/components/MarketContextControl";

type NavItem = [string, string];

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ctx, setCtx] = useState<UserContext | null>(null);
  const [isSeller, setIsSeller] = useState(false);
  const [sellerChecked, setSellerChecked] = useState(false);
  const [sme, setSme] = useState<SmeContext | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    bootstrapUser()
      .then(async (context) => {
        setCtx(context);
        // An unapplied foundation migration must not disrupt existing role access.
        try { setSme(await getSmeContext()); } catch { setSme(null); }

        try {
          const teacherId = (context.teacherProfile as any)?.id ?? null;
          const seller = await findMySeller({
            userId: context.userId,
            teacherId,
          });
          setIsSeller(Boolean(seller));
        } catch {
          setIsSeller(false);
        } finally {
          setSellerChecked(true);
        }
      })
      .catch((error) => router.replace(error instanceof Error && error.message === "ONBOARDING_REQUIRED" ? "/onboarding" : error instanceof Error && error.message === "ACCOUNT_SUSPENDED" ? "/login?suspended=1" : "/login"));
  }, [router]);

  useEffect(() => {
    if (!ctx || !sellerChecked) return;

    const role = String(ctx.role).toUpperCase();
    const allowedPrefixes = ["ADMIN", "OWNER"].includes(role)
      ? ["/admin", "/tenant", "/teacher", "/competition", "/marketplace"]
      : role === "TEACHER"
        ? ["/teacher", "/competition", "/marketplace"]
        : role === "SPONSOR"
          ? ["/sponsor", "/competition", "/marketplace"]
          : ["/student", "/competition", "/marketplace"];

    if (isSeller && ["TEACHER", "ADMIN", "OWNER"].includes(role)) {
      allowedPrefixes.push("/seller");
    }
    allowedPrefixes.push("/account", "/notifications", "/school");
    if (sme?.reviewer || sme?.content_admin || sme?.super_admin) allowedPrefixes.push("/review");
    if (sme?.super_admin) allowedPrefixes.push("/admin/markets", "/admin/reviewers", "/admin/compensation");
    if (sme?.super_admin || sme?.finance_admin) allowedPrefixes.push("/admin/sme-performance", "/admin/payouts");

    const isAllowed = allowedPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

    if (!isAllowed) {
      router.replace(getHomeRouteForRole(role));
    }
  }, [ctx, isSeller, pathname, router, sellerChecked, sme]);

  const nav = useMemo<NavItem[]>(() => {
    if (!ctx) return [];

    const role = String(ctx.role).toUpperCase();
    const extra: NavItem[] = [];
    if (sme?.reviewer || sme?.content_admin || sme?.super_admin) extra.push(["/review", "SME Reviews"]);
    if (sme?.super_admin) extra.push(["/admin/markets", "Markets"], ["/admin/curriculum-sources", "Curriculum Sources"], ["/admin/reviewers", "SME Reviewers"], ["/admin/compensation", "Compensation"]);
    if (sme?.super_admin || sme?.finance_admin) extra.push(["/admin/sme-performance", "SME Performance"], ["/admin/payouts", "Payouts"]);
    if (["ADMIN", "OWNER"].includes(role) && (sme?.super_admin || sme?.content_admin)) extra.push(["/admin/content-factory", "Content Factory"], ["/admin/sme-workforce", "SME Workforce"]);
    const withSeller = (items: NavItem[]): NavItem[] =>
      [...items, ...(isSeller && ["TEACHER", "ADMIN", "OWNER"].includes(role) ? [["/seller", "Seller"] as NavItem] : []), ...extra];

    if (["ADMIN", "OWNER"].includes(role)) {
      return withSeller([
        ["/admin", "Admin"],
        ["/admin/content", "Content"],
        ["/admin/marketplace", "Marketplace"],
        ["/admin/competitions", "Competitions"],
        ["/admin/support", "Support"],
        ["/admin/tenants", "Tenants"],
        ["/admin/market-setup", "Market Setup"],
        ["/admin/quality", "Content Quality"],
        ["/admin/operations", "Operations"],
        ["/marketplace", "Catalogue"],
      ]);
    }

    if (role === "SPONSOR") {
      return withSeller([
        ["/sponsor", "Sponsor"],
        ["/competition", "Competitions"],
        ["/marketplace", "Marketplace"],
      ]);
    }

    if (role === "TEACHER") {
      return withSeller([
        ["/teacher", "Dashboard"],
        ["/teacher/classes", "Classes"],
        ["/teacher/assignments", "Assignments"],
        ["/teacher/question-banks", "Question Banks"],
        ["/teacher/gradebook", "Gradebook"],
        ["/competition", "Competitions"],
        ["/marketplace", "Marketplace"],
      ]);
    }

    return withSeller([
      ["/student", "Home"],
      ["/student/assessments", "Assessments"],
      ["/student/classroom", "Classroom"],
      ["/student/results", "Progress"],
      ["/competition", "Competitions"],
      ["/marketplace", "Marketplace"],
    ]);
  }, [ctx, isSeller, sme]);

  if (!ctx) {
    return <div className="qb-content">Loading QuizBox…</div>;
  }

  const role = String(ctx.role).toUpperCase();
  const name =
    String((ctx.profile as any).full_name ?? "") ||
    String((ctx.profile as any).email ?? "QuizBox User");
  const isStudent = role === "STUDENT" || pathname.startsWith("/student");
  return (
    <div className={`qb-shell ${isStudent ? 'qb-shell-student' : ''}`}>
      <aside className="qb-sidebar">
        <div className="qb-brand">
          <img src="/logo.jpg" alt="QuizBox" style={{ width: "32px", height: "32px", borderRadius: "8px", objectFit: "cover" }} />
          QuizBox
        </div>

        <div className="qb-nav">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(href + '/') ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </div>
      </aside>

      <main className="qb-main">
        <header className="qb-topbar">
          <GlobalSearch/>
          <NotificationBell/>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '1.25rem', borderLeft: '1px solid var(--qb-border)' }}>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: '0.875rem', lineHeight: 1.2 }}>{name}</strong>
              <span className="qb-muted qb-small">{role}</span>
            </div>
            <Link className="qb-btn secondary" style={{ padding: '0.4375rem 0.75rem', fontSize: '0.8125rem' }} href="/account">Account</Link>
            <button
              className="qb-btn ghost" style={{ padding: '0.4375rem 0.75rem', fontSize: '0.8125rem' }}
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="qb-content"><div style={{ marginBottom: '1.5rem' }}><MarketContextControl/></div>{children}</div>

        <nav className="qb-mobile-nav">
          {(sme?.reviewer ? [...nav.slice(0, 3), ["/review", "SME Reviews"] as NavItem] : nav.slice(0, 4)).map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(href + '/') ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
