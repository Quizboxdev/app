import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ensure<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}

export async function getTenantDashboard(tenantId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_tenant_dashboard", {
    p_tenant_id: tenantId,
  });
  return ensure<any>(data, error);
}

export async function getTenantLearningMetrics(tenantId: string, days = 30) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_tenant_learning_metrics", {
    p_tenant_id: tenantId,
    p_days: days,
  });
  return ensure<any>(data, error);
}

export async function getTenantBranding(tenantId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("tenant_branding")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getTenantFeatures(tenantId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("tenant_features")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("feature_code");

  if (error) throw error;
  return data ?? [];
}

export async function getMyTenantMemberships(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("*, tenants(*)")
    .eq("user_id", userId)
    .eq("status", "ACTIVE");

  if (error) throw error;
  return data ?? [];
}
