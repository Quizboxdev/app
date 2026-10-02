"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { bootstrapUser, getHomeRouteForRole, signOut } from "@/lib/auth";
import type { UserContext } from "@/lib/types";
import { findMySeller } from "@/lib/api/marketplace";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";

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
      .catch(() => router.replace("/login"));
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
    if (sme?.super_admin) extra.push(["/admin/markets", "Markets"], ["/admin/reviewers", "SME Reviewers"], ["/admin/compensation", "Compensation"]);
    if (sme?.super_admin || sme?.finance_admin) extra.push(["/admin/sme-performance", "SME Performance"], ["/admin/payouts", "Payouts"]);
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

  return (
    <div className="qb-shell">
      <aside className="qb-sidebar" style={{ overflowY: "auto" }}>
        <div className="qb-brand">QuizBox</div>

        <div className="qb-nav">
          {nav.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
      </aside>

      <main className="qb-main">
        <header className="qb-topbar">
          <div>
            <strong>{name}</strong>
            <div className="qb-muted qb-small">{role}</div>
          </div>

          <button
            className="qb-btn ghost"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </header>

        <div className="qb-content">{children}</div>

        <nav className="qb-mobile-nav">
          {(sme?.reviewer ? [...nav.slice(0, 3), ["/review", "SME Reviews"] as NavItem] : nav.slice(0, 4)).map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
