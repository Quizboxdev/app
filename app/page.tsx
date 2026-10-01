"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        router.replace(getHomeRouteForRole(String(ctx.role)));
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  return <div className="qb-content">Opening QuizBox…</div>;
}
