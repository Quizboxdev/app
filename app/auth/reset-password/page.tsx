"use client";

import { useEffect } from "react";
import { RESET_PASSWORD_PATH } from "@/lib/auth-recovery";

// Previous recovery route, kept because reset emails already sent (and a Supabase allow-list entry) point here.
// It deliberately creates no Supabase client: the one-time recovery code must be spent by /auth/update-password only.
export default function LegacyResetPasswordPage() {
  useEffect(() => { window.location.replace(RESET_PASSWORD_PATH + window.location.search + window.location.hash); }, []);
  return <div className="qb-auth"><div className="qb-auth-card"><p role="status">Opening password reset...</p></div></div>;
}
