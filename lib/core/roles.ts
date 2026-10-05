// Role vocabulary and permission helpers for the single-identity / multi-role model.
// Server RPCs (qb_my_roles, quizbox_core.held_roles) are authoritative; these helpers only drive UI affordances.
export const PLATFORM_ROLES = [
  "student", "parent_guardian", "teacher", "school_admin", "school_owner", "sme_reviewer", "senior_reviewer", "sponsor_user",
  "sponsor_admin", "content_manager", "competition_manager", "support_agent", "finance_admin", "platform_admin", "super_admin",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type MyRoles = {
  roles: PlatformRole[];
  institutions: Array<{ institution_id: string; name: string; role: string }>;
  context: { active_role?: PlatformRole | null; active_institution_id?: string | null; last_app?: string | null };
  onboarding_completed: boolean;
};

export type RelationshipPermission = "can_fund" | "can_view_progress" | "can_manage_account";

const STAFF: PlatformRole[] = ["super_admin", "platform_admin"];
const HOME: Array<[PlatformRole[], string]> = [
  [["super_admin", "platform_admin", "support_agent", "finance_admin", "content_manager", "competition_manager"], "/admin"],
  [["sme_reviewer", "senior_reviewer"], "/review"],
  [["school_owner", "school_admin"], "/school"],
  [["teacher"], "/teacher"],
  [["sponsor_admin", "sponsor_user"], "/sponsor"],
  [["parent_guardian"], "/student"],
  [["student"], "/student"],
];

export const hasRole = (roles: readonly string[], ...wanted: PlatformRole[]) => wanted.some((role) => roles.includes(role));
export const isPlatformStaff = (roles: readonly string[]) => hasRole(roles, ...STAFF);
export const canAccess = (roles: readonly string[], allowed: readonly PlatformRole[]) => isPlatformStaff(roles) || hasRole(roles, ...allowed);

// Prefer the remembered workspace if the identity still holds that role; otherwise the first matching home.
export function homeRouteForWorkspace(roles: readonly string[], active?: string | null): string {
  const pick = (candidates: readonly string[]) => HOME.find(([group]) => group.some((role) => candidates.includes(role)))?.[1];
  return (active && roles.includes(active) ? pick([active]) : undefined) ?? pick(roles) ?? "/student";
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}
