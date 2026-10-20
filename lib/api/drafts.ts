import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { DraftKind } from "@/lib/drafts/format";

// The draft holder (migration 20261028100000). Every call can fail quietly: a draft that cannot be saved must never get in the way of the form it protects.
export type DraftInfo = { id: string; title: string; path: string | null; updated_at: string; expires_at: string };
export type DraftRow = DraftInfo & { kind: DraftKind; scope_key: string };
export type DraftFull = DraftInfo & { payload: Record<string, unknown> };

const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(error.message); return data as T; });

export const saveDraft = (kind: DraftKind, key: string, title: string, payload: object, path: string) => rpc<{ id: string; expires_at: string }>("qb_draft_save", { p_kind: kind, p_key: key, p_title: title, p_payload: payload, p_path: path });
export const getDraft = (kind: DraftKind, key = "new") => rpc<DraftFull | null>("qb_draft_get", { p_kind: kind, p_key: key });
export const listDrafts = () => rpc<DraftRow[]>("qb_draft_list");
export const deleteDraft = (kind: DraftKind, key = "new") => rpc<void>("qb_draft_delete", { p_kind: kind, p_key: key });
export const discardDraft = (id: string) => rpc<void>("qb_draft_discard", { p_id: id });
export const keepDraft = (id: string) => rpc<{ id: string; expires_at: string }>("qb_draft_keep", { p_id: id });
