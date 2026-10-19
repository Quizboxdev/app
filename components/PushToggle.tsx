"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { disablePush, enablePush, getPushStatus, pushSupported, thisDeviceSubscribed } from "@/lib/push/client";

// "Notifications on this device": one switch on the Account page. Hidden when the phone or browser cannot do push, when the server has no keys yet,
// and for young learners' accounts (the database refuses them too). Turning it on asks the browser for permission; turning it off removes this device.
export default function PushToggle() {
  const [visible, setVisible] = useState(false), [on, setOn] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    if (!pushSupported()) return;
    let alive = true;
    void Promise.all([getPushStatus(), thisDeviceSubscribed()]).then(([status, here]) => { if (alive && status.allowed) { setVisible(true); setOn(here && Notification.permission === "granted"); } });
    return () => { alive = false; };
  }, []);
  if (!visible) return null;

  async function toggle() {
    setBusy(true); setMessage("");
    if (on) { setOn(!(await disablePush())); setBusy(false); return; }
    const result = await enablePush();
    if (result === "ok") setOn(true);
    else setMessage(result === "denied" ? "Notifications are blocked for this site. Allow them in your browser settings, then try again." : result === "unsupported" ? "This browser cannot show notifications." : "Could not turn notifications on. Please try again.");
    setBusy(false);
  }
  return (
    <div className="qb-card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <BellRing size={20} aria-hidden="true" />
      <div style={{ flex: "1 1 220px" }}>
        <strong>Notifications on this device</strong>
        <p className="qb-muted qb-small" style={{ margin: "4px 0 0" }}>Get a message on this phone when an assignment is due, a result is ready or you win a prize. You can turn this off any time.</p>
        {message && <p role="alert" className="qb-small">{message}</p>}
      </div>
      <button className={`qb-btn ${on ? "qb-btn-secondary" : ""}`} onClick={() => void toggle()} disabled={busy} aria-pressed={on}>{busy ? "Please wait…" : on ? "Turn off" : "Turn on"}</button>
    </div>
  );
}
