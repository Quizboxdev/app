import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { StructureNode } from "@/lib/curriculum/structure";

export type CurriculumChoice = { id: string; code: string; name: string; version: string; market_id: string | null; active: boolean; nodes: number; approved_sources: number };

// Every curriculum, inactive ones included: structure is loaded before a curriculum is activated. Reads go through the super-admin
// market setup RPC, because the market access policy hides inactive curricula from ordinary table reads.
export async function listAllCurricula(): Promise<CurriculumChoice[]> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_market_setup", { p_action: "curricula", p_data: {} });
  if (error) throw new Error(userFacingError(error));
  return ((data ?? []) as Array<{ curriculum_id: string; code: string; name: string; version: string; market_id: string | null; active: boolean | null; nodes: number | null; approved_sources: number | null }>)
    .map((c) => ({ id: c.curriculum_id, code: c.code, name: c.name, version: c.version, market_id: c.market_id, active: Boolean(c.active), nodes: Number(c.nodes ?? 0), approved_sources: Number(c.approved_sources ?? 0) }));
}

export async function importStructureChunk(curriculumId: string, nodes: StructureNode[], sourceFile: string, sourceVersion: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_curriculum_nodes_import", {
    p_curriculum: curriculumId, p_nodes: nodes, p_source_file: sourceFile, p_source_version: sourceVersion,
  });
  if (error) throw new Error(userFacingError(error));
  return data as { inserted: number; existing: number };
}
