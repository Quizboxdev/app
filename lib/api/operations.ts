import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { sanitizedFailure } from "@/lib/operations/safety";
export async function recordFailure(operation: string,error: unknown) {
  const event=sanitizedFailure(operation,error && typeof error==="object" && "message" in error ? error.message : error);
  // Failure recording must not replace the original user-facing error.
  await getSupabaseBrowserClient().rpc("qb_operation_failure",{p_operation:event.operation,p_code:event.code});
}
