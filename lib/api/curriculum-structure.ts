import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { StructureNode } from "@/lib/curriculum/structure";

export type CurriculumChoice = { id: string; code: string; name: string; version: string; country: string; market_id: string | null };

// Every curriculum, inactive ones included: structure is loaded before a curriculum is activated.
export async function listAllCurricula(): Promise<CurriculumChoice[]> {
  const { data, error } = await getSupabaseBrowserClient().from("curricula").select("id,code,name,version,country,market_id").order("name");
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as CurriculumChoice[];
}

export async function importStructureChunk(curriculumId: string, nodes: StructureNode[], sourceFile: string, sourceVersion: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_curriculum_nodes_import", {
    p_curriculum: curriculumId, p_nodes: nodes, p_source_file: sourceFile, p_source_version: sourceVersion,
  });
  if (error) throw new Error(userFacingError(error));
  return data as { inserted: number; existing: number };
}
