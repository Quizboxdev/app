import { createClient } from "@supabase/supabase-js";
import { validatePublicEnvironment } from "../lib/env";
export async function operatorClient() {
  try { process.loadEnvFile(".env.local"); } catch (error: any) { if (error.code !== "ENOENT") throw new Error("ENVIRONMENT_LOAD_FAILED"); }
  validatePublicEnvironment({NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  const email = process.env.QB_CONTENT_OPERATOR_EMAIL, password = process.env.QB_CONTENT_OPERATOR_PASSWORD;
  if (!email || !password) throw new Error("CONTENT_OPERATOR_CREDENTIALS_REQUIRED");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("CONTENT_OPERATOR_LOGIN_FAILED");
  return client;
}
export async function allRows(client: Awaited<ReturnType<typeof operatorClient>>, table: string, columns = "*") {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const result = await client.from(table).select(columns).order("id").range(from, from + 499);
    if (result.error) throw new Error("OPERATOR_READ_FAILED_" + table);
    rows.push(...(result.data ?? [])); if ((result.data?.length ?? 0) < 500) return rows;
  }
}
