"use client";

import { useState, type InputHTMLAttributes } from "react";

// Password input with an accessible show/hide toggle. `visible`/`onToggle` make it controlled when several fields share one toggle.
export default function PasswordField({ id, label, visible, onToggle, ...input }: { id: string; label: string; visible?: boolean; onToggle?: () => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  const [own, setOwn] = useState(false);
  const shown = visible ?? own;
  return (
    <div className="qb-field">
      <label htmlFor={id}>{label}</label>
      <div className="qb-input-affix">
        <input id={id} type={shown ? "text" : "password"} {...input} />
        <button type="button" className="qb-input-toggle" onClick={onToggle ?? (() => setOwn((v) => !v))} aria-controls={id} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
