import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { readJson } from "./http";
import type { WorkspaceAction } from "@/lib/competition/repository";

export async function sponsorWorkspaceRequest<T>(action: WorkspaceAction, sponsor: string | null = null, data: Record<string, unknown> = {}): Promise<T> {
  return sponsorRequest<T>("/api/sponsor/workspace", JSON.stringify({ action, sponsor, data }));
}
export async function sponsorRequest<T>(path: string, body: string | FormData): Promise<T> {
  const session = await getSupabaseBrowserClient().auth.getSession();
  const token = session.data.session?.access_token; if (!token) throw new Error("AUTH_REQUIRED");
  const response = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) }, body });
  const data = await readJson(response, "sponsor workspace"); if (!response.ok) throw new Error(data.error ?? "SPONSOR_REQUEST_FAILED");
  return data as T;
}
