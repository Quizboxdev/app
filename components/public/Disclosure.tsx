"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function Disclosure({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="qbp-disclosure">
      <button type="button" className="qbp-disclosure-btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div id={panelId} className="qbp-disclosure-panel" hidden={!open}>{children}</div>
    </div>
  );
}
