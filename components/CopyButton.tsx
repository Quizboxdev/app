"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

// A copy button that says so: the label changes to "Copied" with a tick for a couple of seconds (and is announced to screen readers).
// Where the browser blocks clipboard access, the text is shown in a prompt so it can still be copied by hand.
export default function CopyButton({ text, label = "Copy code", className = "qb-btn qb-btn-secondary" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy this", text); return; }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  return <button className={className} type="button" onClick={() => void copy()} aria-live="polite">
    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Copied" : label}
  </button>;
}
