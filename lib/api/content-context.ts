import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GenerationSpec } from "@/lib/content/factory/contract";
import type { ResolvedGenerationSources } from "@/lib/content/factory/generation";

export type MarketOption = { id: string; name: string; country_id: string; locale: string; timezone: string };
export type MarketContext = { scope: string; source_mode: string; market_ids: string[]; source_document_ids: string[]; locale?: string; timezone?: string };
export type SourceOption = { id: string; title: string; kind: string; market_id: string | null; curriculum_id: string | null; checksum: string };
async function call<T>(name: string, args = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export const getContentMarketContext = () => call<MarketContext>("qb_content_market_context");
export const listAuthorizedMarkets = () => call<MarketOption[]>("qb_list_content_markets");
export const selectContentMarket = (market: string) => call<void>("qb_select_content_market", { p_market: market });
export const listAuthorizedSources = (curriculum?: string, selection?: { scope: string; markets: string[] }) => call<SourceOption[]>("qb_list_content_sources", { p_curriculum: curriculum ?? null, p_scope: selection?.scope ?? null, p_markets: selection?.markets ?? null });
export const resolveGenerationSources = (spec: GenerationSpec) => call<ResolvedGenerationSources>("qb_resolve_generation_sources", { p_spec: spec });
export const createContentContext = (scope: string, mode: string, markets: string[], sources: string[]) => call<string>("qb_create_content_context", { p_scope: scope, p_source_mode: mode, p_markets: markets, p_sources: sources });
export const activateContentContext = (context: string) => call<void>("qb_activate_content_context", { p_context: context });
export const setCompetitionContentContext = (competition: string, context: string) => call<void>("qb_set_competition_content_context", { p_competition: competition, p_context: context });
