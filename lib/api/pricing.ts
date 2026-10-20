import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { PriceAdminRow, PriceRow } from "@/lib/pricing/format";

// Prices for screens inside the app. The admin calls are closed to everyone but owners, admins and finance admins in the database itself.
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) throw new Error(/NOT_AUTHORIZED/.test(error.message) ? "Only an owner, admin or finance admin can change prices." : /check|violates|INVALID_PRICE/.test(error.message) ? "Check the fields. The payment link must start with https:// and the price must be a number." : userFacingError(error));
  return data as T;
});
export const listPrices = () => rpc<PriceRow[]>("qb_price_list");
export const listPricesAdmin = () => rpc<PriceAdminRow[]>("qb_price_list_admin");
export const savePrice = (code: string, row: Record<string, unknown>) => rpc<PriceAdminRow>("qb_price_save", { p_code: code, p_row: row });
