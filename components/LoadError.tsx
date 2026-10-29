import Link from "next/link";

// A failed load keeps the user oriented: what happened, one button to try again, one way to get help (audit UX-014).
export default function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="qb-card qb-error" role="alert">
      <p style={{ marginTop: 0 }}>{message}</p>
      <div className="qb-actions">
        {onRetry && <button type="button" className="qb-btn" onClick={onRetry}>Try again</button>}
        <Link className="qb-btn secondary" href="/support/new">Contact support</Link>
      </div>
    </div>
  );
}
