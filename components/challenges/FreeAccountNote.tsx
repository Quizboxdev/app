"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// The "you need a free account" wording on a public challenge or competition page. It is part of the page for visitors and search engines, and is taken away once the browser
// shows the person is already signed in. If the session cannot be read, the wording stays (the signed-out look is the safe default).
export default function FreeAccountNote({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    try { getSupabaseBrowserClient().auth.getSession().then(({ data }) => { if (alive && data.session) setSignedIn(true); }).catch(() => undefined); } catch { /* keep the note */ }
    return () => { alive = false; };
  }, []);
  return signedIn ? null : <>{children}</>;
}
