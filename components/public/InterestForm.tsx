import { isIntakeAvailable, type InterestKind } from "@/lib/public/intake";

export type InterestField =
  | { name: string; label: string; type: "text" | "email" | "tel" | "number"; required?: boolean; autoComplete?: string; full?: boolean }
  | { name: string; label: string; type: "textarea"; required?: boolean; full?: boolean; maxLength?: number }
  | { name: string; label: string; type: "select"; options: readonly string[]; required?: boolean; full?: boolean };

// Public expression-of-interest form. While no governed intake storage exists for this kind
// (see docs/proposals/public-intake-contract.md), the whole form is disabled: no active-looking
// submit button, nothing can be sent, and success is never simulated. When the intake endpoint is
// approved and implemented, flip INTAKE_STATUS in lib/public/intake.ts and add the submit handler.
export default function InterestForm({ kind, fields, submitLabel, consentLabel }: { kind: InterestKind; fields: InterestField[]; submitLabel: string; consentLabel: string }) {
  const available = isIntakeAvailable(kind);
  const noticeId = `qbp-intake-${kind}-notice`;
  return (
    <form className="qbp-form qb-form" data-qb-intake={kind} data-qb-intake-status={available ? "OPEN" : "COMING_SOON"} aria-describedby={available ? undefined : noticeId}>
      {!available && (
        <div id={noticeId} className="qbp-notice" role="note">
          <strong>Expression of interest form coming soon</strong>
          <span style={{ display: "block" }}>Online submissions are not open yet. The details we will ask for are shown below.</span>
        </div>
      )}
      <fieldset disabled={!available} className="qbp-fieldset">
        <legend className="qbp-sr-only">Your details</legend>
        <div className="qbp-form-grid">
          {fields.map((field) => {
            const fieldId = `qbp-${kind}-${field.name}`;
            const label = `${field.label}${field.required ? "" : " (optional)"}`;
            return (
              <div key={field.name} className="qb-field" style={field.full || field.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                <label htmlFor={fieldId}>{label}</label>
                {field.type === "textarea" ? (
                  <textarea id={fieldId} name={field.name} required={field.required} maxLength={field.maxLength ?? 1500} />
                ) : field.type === "select" ? (
                  <select id={fieldId} name={field.name} required={field.required} defaultValue="">
                    <option value="" disabled>Select…</option>
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={fieldId} name={field.name} type={field.type} required={field.required} autoComplete={field.autoComplete} maxLength={200} min={field.type === "number" ? 0 : undefined} />
                )}
              </div>
            );
          })}
        </div>
        <label className="qbp-check" style={{ marginTop: 14 }}><input type="checkbox" name="consent" required />{consentLabel}</label>
        <div className="qbp-actions" style={{ marginTop: 14 }}>
          <button type="submit" className="qbp-btn" disabled={!available}>{available ? submitLabel : "Coming soon"}</button>
        </div>
      </fieldset>
    </form>
  );
}
