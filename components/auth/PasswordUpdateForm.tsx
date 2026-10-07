import type { FormEvent } from "react";

// Presentation only: the page owns state and the Supabase calls, so this renders identically on the server (tests) and in the browser.
export type PasswordUpdateFormProps = {
  password: string; confirmation: string; visible: boolean; busy: boolean; error: string; minLength: number; requirements: readonly string[];
  onPassword: (value: string) => void; onConfirmation: (value: string) => void; onToggleVisible: () => void; onSubmit: (event: FormEvent) => void;
};

export default function PasswordUpdateForm({ password, confirmation, visible, busy, error, minLength, requirements, onPassword, onConfirmation, onToggleVisible, onSubmit }: PasswordUpdateFormProps) {
  const type = visible ? "text" : "password";
  const met = [password.length >= minLength, password.length > 0 && password === confirmation];
  return <form className="qb-form" onSubmit={onSubmit} aria-label="Set a new password" noValidate>
    <div className="qb-field"><label htmlFor="new-password">New password</label>
      <input id="new-password" name="new-password" type={type} autoComplete="new-password" required disabled={busy} value={password} onChange={event => onPassword(event.target.value)} aria-describedby="password-requirements" /></div>
    <div className="qb-field"><label htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" name="confirm-password" type={type} autoComplete="new-password" required disabled={busy} value={confirmation} onChange={event => onConfirmation(event.target.value)} aria-describedby="password-requirements" /></div>
    <label className="qb-check qb-auth-check"><input type="checkbox" checked={visible} onChange={onToggleVisible} /> Show passwords</label>
    <ul id="password-requirements" className="qb-auth-reqs" aria-label="Password requirements">
      {requirements.map((text, index) => <li key={text} data-met={met[index]}><span aria-hidden>{met[index] ? "✓" : "○"}</span> {text}</li>)}
    </ul>
    {error && <p role="alert" className="qb-auth-alert is-error">{error}</p>}
    <button type="submit" className="qb-btn qb-btn-block" disabled={busy} aria-busy={busy}>{busy && <span className="qb-spinner" aria-hidden />}{busy ? "Updating…" : "Update password"}</button>
  </form>;
}
