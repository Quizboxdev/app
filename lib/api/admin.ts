import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ensure<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}

export async function getPlatformOverview() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_platform_overview");
  return ensure<any>(data, error);
}

export async function getContentHealth() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_content_health");
  return ensure<any>(data, error);
}

export async function getQuestionDistribution() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_question_distribution");
  return ensure<any[]>(data, error);
}

export async function getMarketplaceMetrics() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_marketplace_metrics");
  return ensure<any>(data, error);
}

export async function getCompetitionMetrics() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_competition_metrics");
  return ensure<any>(data, error);
}

export async function getOperationsHealth() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_operations_health");
  return ensure<any>(data, error);
}

export async function getEventSummary(days = 30) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_admin_event_summary", {
    p_days: days,
  });
  return ensure<any[]>(data, error);
}

export async function listSupportTickets() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return data ?? [];
}

export async function listFeatureFlags() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("*")
    .order("feature_code");

  if (error) throw error;
  return data ?? [];
}

export async function grantManualEntitlement(args: {
  userId: string;
  productId: string;
  entitlementType?: string;
}) {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("entitlements")
    .insert({
      beneficiary_user_id: args.userId,
      source_type: "ADMIN_GRANT",
      source_id: args.productId,
      entitlement_type: args.entitlementType ?? "MARKETPLACE_PRODUCT",
      product_id: args.productId,
      scope: { product_id: args.productId, grant_mode: "MANUAL" },
      starts_at: new Date().toISOString(),
      status: "ACTIVE",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
