import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ensure<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}

export async function listMarketplaceProducts() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_marketplace_catalog");

  if (error) throw error;
  return data ?? [];
}

export async function listMyEntitlements(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("entitlements")
    .select("*, marketplace_products:product_id(*)")
    .eq("beneficiary_user_id", userId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getSellerDashboard(sellerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_seller_dashboard", {
    p_seller_id: sellerId,
  });
  return ensure<any>(data, error);
}

export async function getSellerBalance(sellerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_seller_balance", {
    p_seller_id: sellerId,
  });
  return ensure<any>(data, error);
}

export async function findMySeller(args: {
  userId: string;
  teacherId?: string | null;
}) {
  const supabase = getSupabaseBrowserClient();

  if (args.teacherId) {
    const { data, error } = await supabase
      .from("marketplace_sellers")
      .select("*")
      .eq("seller_type", "TEACHER")
      .eq("seller_entity_id", args.teacherId)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  const { data, error } = await supabase
    .from("marketplace_sellers")
    .select("*")
    .eq("seller_type", "USER")
    .eq("seller_entity_id", args.userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listSellerProducts(sellerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("marketplace_products")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createSellerProduct(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("marketplace_products")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listPayoutAccounts(sellerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("payout_accounts")
    .select("*")
    .eq("seller_id", sellerId)
    .eq("status", "ACTIVE");

  if (error) throw error;
  return data ?? [];
}

export async function listPayouts(sellerId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("payouts")
    .select("*")
    .eq("seller_id", sellerId)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function requestPayout(args: {
  sellerId: string;
  amount: number;
  payoutAccountId: string;
}) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_request_payout", {
    p_seller_id: args.sellerId,
    p_amount: args.amount,
    p_payout_account_id: args.payoutAccountId,
  });
  return ensure<any>(data, error);
}
