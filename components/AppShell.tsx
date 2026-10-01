"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { bootstrapUser, getHomeRouteForRole, signOut } from "@/lib/auth";
import type { UserContext } from "@/lib/types";
import { findMySeller } from "@/lib/api/marketplace";

type NavItem = [string, string];

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ctx, setCtx] = useState<UserContext | null>(null);
  const [isSeller, setIsSeller] = useState(false);
  const [sellerChecked, setSellerChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    bootstrapUser()
      .then(async (context) => {
        setCtx(context);

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

    const isAllowed = allowedPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

    if (!isAllowed) {
      router.replace(getHomeRouteForRole(role));
    }
  }, [ctx, isSeller, pathname, router, sellerChecked]);

  const nav = useMemo<NavItem[]>(() => {
    if (!ctx) return [];

    const role = String(ctx.role).toUpperCase();
    const withSeller = (items: NavItem[]): NavItem[] =>
      isSeller ? [...items, ["/seller", "Seller"] as NavItem] : items;

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
      return [
        ["/sponsor", "Sponsor"],
        ["/competition", "Competitions"],
        ["/marketplace", "Marketplace"],
      ];
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

    return [
      ["/student", "Home"],
      ["/student/assessments", "Assessments"],
      ["/student/classroom", "Classroom"],
      ["/student/results", "Progress"],
      ["/competition", "Competitions"],
      ["/marketplace", "Marketplace"],
    ];
  }, [ctx, isSeller]);

  if (!ctx) {
    return <div className="qb-content">Loading QuizBox…</div>;
  }

  const role = String(ctx.role).toUpperCase();
  const name =
    String((ctx.profile as any).full_name ?? "") ||
    String((ctx.profile as any).email ?? "QuizBox User");

  return (
    <div className="qb-shell">
      <aside className="qb-sidebar">
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
          {nav.slice(0, 4).map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
