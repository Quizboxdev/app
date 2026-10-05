"use client";

import { createContext, useContext } from "react";
import { useWorkspace } from "@/lib/core/useWorkspace";

type Workspace = ReturnType<typeof useWorkspace>;
const WorkspaceContext = createContext<Workspace | null>(null);

// Mounted once inside the authenticated AppShell. It renders no UI and fails soft: until the core-platform
// migration is applied, qb_my_roles errors, `error` is set, and existing role gating in AppShell is unaffected.
export default function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return <WorkspaceContext.Provider value={useWorkspace()}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used inside AppShell");
  return value;
}
