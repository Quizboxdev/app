"use client";

import { useCallback, useEffect, useState } from "react";

// Small shared pieces for the inter-school screens.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined), [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setData(await load()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Please try again."); }
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

// Runs one action at a time, shows what went wrong or what happened, then refreshes.
export function useAction(after?: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const run = useCallback(async (action: () => Promise<unknown>, success = "") => {
    setBusy(true); setError(""); setDone("");
    try { await action(); setDone(success); await after?.(); return true; }
    catch (e) { const detail = (e as { detail?: string }).detail; setError(`${e instanceof Error ? e.message : "That did not work."}${detail && !detail.startsWith("[") ? ` (${detail})` : ""}`); return false; }
    finally { setBusy(false); }
  }, [after]);
  return { busy, error, done, run };
}

export function Notice({ error, done }: { error?: string; done?: string }) {
  return <>{error && <div className="qb-card qb-error" role="alert">{error}</div>}{done && <div className="qb-card" role="status">{done}</div>}</>;
}
export const Loading = ({ error }: { error?: string }) => (error ? <div className="qb-card qb-error" role="alert">{error}</div> : <div className="qb-card" role="status">Loading…</div>);
export function Head({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="qb-page-head"><div><h1>{title}</h1>{lead && <p>{lead}</p>}</div>{children && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>}</div>;
}
export const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="qb-table-wrap"><table className="qb-table"><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);
export const Row = ({ children }: { children: React.ReactNode }) => <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{children}</div>;
export const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="qb-card" style={{ display: "grid", gap: 2, minWidth: 130 }}><span className="qb-muted qb-small">{label}</span><strong style={{ fontSize: 22 }}>{value}</strong></div>;
// A reason typed in a prompt: empty or cancelled means "do nothing".
export const askReason = (question: string): string | null => { const r = window.prompt(question)?.trim(); return r ? r : null; };
