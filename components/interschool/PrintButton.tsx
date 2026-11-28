"use client";

export default function PrintButton({ label }: { label: string }) {
  return <button type="button" className="qb-btn" style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }} onClick={() => window.print()}>{label}</button>;
}
