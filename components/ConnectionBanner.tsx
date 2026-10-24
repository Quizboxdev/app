"use client";

import { useEffect, useState } from "react";

// Tells the user when the connection drops and when it returns (audit UX-022). The browser's online/offline events are the signal;
// the quiz player and other screens show their own messages for failed requests.
export default function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  const [back, setBack] = useState(false);
  useEffect(() => {
    setOnline(navigator.onLine);
    let timer = 0;
    const goOffline = () => { window.clearTimeout(timer); setOnline(false); setBack(false); };
    const goOnline = () => { setOnline(true); setBack(true); window.clearTimeout(timer); timer = window.setTimeout(() => setBack(false), 3000); };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.clearTimeout(timer); window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);
  if (online && !back) return null;
  return (
    <div role="status" aria-live="polite" className={`qb-conn ${online ? "back" : "off"}`}>
      {online ? "You are back online." : "You are offline. Check your connection; recent changes may not be saved."}
    </div>
  );
}
