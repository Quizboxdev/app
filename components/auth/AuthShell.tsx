import type { ReactNode } from "react";
import BrandLockup from "@/components/BrandLockup";

// Shared frame for every signed-out screen (sign in, register, reset, new password, email-link landing):
// a brand panel on wide screens and a single focused card everywhere.
export default function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="qb-auth qb-auth-v2">
      <aside className="qb-auth-aside" aria-hidden="true">
        <div className="qb-auth-aside-inner">
          <p className="qb-auth-kicker">QuizBox</p>
          <p className="qb-auth-pitch">Learn. Practice. Compete.</p>
          <ul className="qb-auth-points">
            <li>Curriculum-aligned practice for every grade</li>
            <li>Assessments with instant, detailed results</li>
            <li>Competitions with SME-reviewed questions</li>
          </ul>
        </div>
      </aside>
      <main className="qb-auth-main">
        <div className="qb-auth-card">
          <BrandLockup variant="responsive" href="/" size={40} priority />
          <h1 className="qb-auth-title">{title}</h1>
          {subtitle && <p className="qb-auth-subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="qb-auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
