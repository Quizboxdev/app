"use client";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { useWorkspaceContext } from "@/components/WorkspaceProvider";
import { homeRouteForWorkspace, isPlatformRole, type PlatformRole } from "@/lib/core/roles";
import { humanize } from "@/lib/format";

// Design-system "context chip": current organisation + role. Binds to the existing workspace API (qb_my_roles / switchWorkspace);
// shows nothing until the core-platform data loads, and only offers switching when the identity holds more than one workspace.
export default function WorkspaceChip() {
  const { me, roles, switchTo } = useWorkspaceContext();
  const router = useRouter();
  if (!me) return null;

  const options = [
    ...me.institutions.filter((row) => isPlatformRole(row.role)).map((row) => ({ role: row.role as PlatformRole, institutionId: row.institution_id as string | null, label: `${row.name} · ${humanize(row.role)}` })),
    ...roles.filter((role) => !me.institutions.some((row) => row.role === role)).map((role) => ({ role, institutionId: null as string | null, label: humanize(role) })),
  ];
  if (!options.length) return null;

  const key = (role: string, institutionId: string | null) => `${role}|${institutionId ?? ""}`;
  const activeRole = me.context.active_role ?? options[0].role;
  const activeInstitution = me.context.active_institution_id ?? null;
  const current = options.find((o) => key(o.role, o.institutionId) === key(activeRole, activeInstitution)) ?? options[0];

  if (options.length === 1) {
    return <span className="qb-context-chip"><Building2 size={14} aria-hidden="true" />{current.label}</span>;
  }
  return (
    <label className="qb-context-chip">
      <Building2 size={14} aria-hidden="true" />
      <span className="qb-sr-only">Switch workspace</span>
      <select
        value={key(current.role, current.institutionId)}
        onChange={async (event) => {
          const next = options.find((o) => key(o.role, o.institutionId) === event.target.value);
          if (!next) return;
          await switchTo(next.role, next.institutionId);
          router.push(homeRouteForWorkspace(roles, next.role));
        }}
      >
        {options.map((o) => <option key={key(o.role, o.institutionId)} value={key(o.role, o.institutionId)}>{o.label}</option>)}
      </select>
    </label>
  );
}
