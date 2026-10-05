"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyRoles, loadFlags, switchWorkspace } from "@/lib/api/core";
import { DEFAULT_FLAGS, type FlagMap } from "@/lib/core/config";
import { canAccess, homeRouteForWorkspace, type MyRoles, type PlatformRole } from "@/lib/core/roles";

// Workspace context for the new UI: roles held by this identity, remembered workspace, feature flags.
export function useWorkspace() {
  const [state, setState] = useState<{ loading: boolean; error: string | null; me: MyRoles | null; flags: FlagMap }>({ loading: true, error: null, me: null, flags: DEFAULT_FLAGS });

  const refresh = useCallback(async () => {
    try {
      const [me, flags] = await Promise.all([getMyRoles(), loadFlags().catch(() => DEFAULT_FLAGS)]);
      setState({ loading: false, error: null, me, flags });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : "WORKSPACE_LOAD_FAILED" }));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const roles = state.me?.roles ?? [];
  return {
    ...state,
    roles,
    activeRole: (state.me?.context.active_role ?? null) as PlatformRole | null,
    homeRoute: homeRouteForWorkspace(roles, state.me?.context.active_role),
    can: (allowed: readonly PlatformRole[]) => canAccess(roles, allowed),
    switchTo: async (role: PlatformRole, institutionId: string | null = null, app: string | null = null) => { await switchWorkspace(role, institutionId, app); await refresh(); },
    refresh,
  };
}
