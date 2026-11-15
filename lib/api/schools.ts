import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// The school directory (migration 20261074100000). The database decides who may add, approve, merge or import; this file only asks and shows.
export type Ownership = "public" | "private";
export type SchoolLevel = "primary" | "jhs" | "shs";
export const LEVEL_LABEL: Record<SchoolLevel, string> = { primary: "Primary", jhs: "JHS", shs: "SHS" };
export const OWNERSHIP_LABEL: Record<Ownership, string> = { public: "Public", private: "Private" };

export type RegionCount = { region: string; schools: number };
export type DistrictCount = { district: string; schools: number };
export type SchoolPick = { id: string; name: string; ownership: Ownership | null; levels: SchoolLevel[]; town: string | null; district: string; region: string; pending: boolean };
export type SchoolFilter = { ownership?: Ownership | ""; level?: SchoolLevel | "" };

export type SimilarSchool = { id: string; name: string; ownership: Ownership | null; district: string; town: string | null };
export type DirectoryStatus = "pending" | "approved" | "rejected" | "merged";
export type AdminSchool = {
  id: string; name: string; ownership: Ownership | null; region: string; district: string; town: string | null; levels: SchoolLevel[]; status: DirectoryStatus; needs_review: boolean; source: string | null;
  submitted_at: string | null; decided_at: string | null; decision_note: string | null; merged_into: string | null; submitter_name: string | null; submitter_email: string | null; users_linked: number; similar: SimilarSchool[];
};
export type AdminSchoolList = { total: number; rows: AdminSchool[]; counts: Partial<Record<DirectoryStatus, number>> };
export type SchoolFix = { name?: string; district?: string; town?: string | null; ownership?: Ownership | ""; levels?: SchoolLevel[] };
export type ImportResult = { added: number; updated: number; skipped: number; problems: { row: number; name: string; why: string }[] };

const MESSAGES: Record<string, string> = {
  QB_AUTHENTICATION_REQUIRED: "Please sign in.", SUPER_ADMIN_REQUIRED: "Only a super administrator can do that.", QB_FEATURE_DISABLED: "The school directory is not open yet.",
  QB_SCHOOL_INVALID: "Check the school name, region and district. A name cannot contain links or symbols such as < > or @.", QB_SCHOOL_LEVEL_REQUIRED: "Choose at least one level: Primary, JHS or SHS.",
  QB_SCHOOL_REGION_REQUIRED: "Choose a region first.", QB_SCHOOL_DISTRICT_REQUIRED: "Choose a district, or type part of the school's name.", QB_RATE_LIMITED: "You already have schools waiting for approval. Please wait for staff to review them.",
  QB_SCHOOL_ALREADY_SET: "Your school is already set. To change it, use Edit profile.", QB_NOT_FOUND: "We could not find that school.", QB_SCHOOL_DUPLICATE: "Another school already has this name in this district. Merge the two instead.",
  QB_INVALID_TRANSITION: "That school has already been decided.", QB_INVALID_ACTION: "That choice is not allowed.", QB_REASON_REQUIRED: "Please write a short reason (at least 5 characters).", QB_TOO_MANY_ROWS: "Too many rows in one go.",
};
const message = (e: { message?: string }) => MESSAGES[/(QB_[A-Z_]+|SUPER_ADMIN_REQUIRED)/.exec(e.message ?? "")?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(message(error)); return data as T; });

// Pickers (students and teachers). Each narrows by the Public / Private and level filters.
export const listSchoolRegions = (f: SchoolFilter = {}) => rpc<RegionCount[]>("qb_school_regions", { p_country: "GH", p_ownership: f.ownership || null, p_level: f.level || null });
export const listSchoolDistricts = (region: string, f: SchoolFilter = {}) => rpc<DistrictCount[]>("qb_school_districts", { p_region: region, p_country: "GH", p_ownership: f.ownership || null, p_level: f.level || null });
export const searchSchools = (a: { region: string; district?: string; query?: string } & SchoolFilter) =>
  rpc<SchoolPick[]>("qb_school_search", { p_region: a.region, p_district: a.district || null, p_ownership: a.ownership || null, p_level: a.level || null, p_query: a.query?.trim() || null, p_limit: 60, p_country: "GH" });
export const submitSchool = (a: { region: string; district: string; name: string; ownership?: Ownership | ""; levels: SchoolLevel[]; town?: string }) =>
  rpc<{ id: string; status: DirectoryStatus; existing: boolean; name: string }>("qb_school_submit", { p_region: a.region, p_district: a.district, p_name: a.name, p_ownership: a.ownership || null, p_levels: a.levels, p_town: a.town?.trim() || null, p_country: "GH" });
export const setMySchool = (schoolId: string) => rpc<{ school_id: string; name: string; pending: boolean }>("qb_school_set_mine", { p_school: schoolId });

// Staff
export type AdminSort = "recent" | "name" | "region" | "district" | "linked";
export type AdminListFilter = { query?: string; region?: string; district?: string; ownership?: Ownership | "unset" | ""; level?: SchoolLevel | ""; sort?: AdminSort; dir?: "asc" | "desc" };
export const adminListSchools = (status: DirectoryStatus, f: AdminListFilter = {}, limit = 50, offset = 0) =>
  rpc<AdminSchoolList>("qb_school_admin_list", {
    p_status: status, p_query: f.query?.trim() || null, p_limit: limit, p_offset: offset, p_region: f.region || null, p_district: f.district || null,
    p_ownership: f.ownership || null, p_level: f.level || null, p_sort: f.sort ?? "recent", p_dir: f.dir ?? "desc",
  });

export type RegionStat = { region: string; private: number; public: number; unset: number; total: number };
export type SchoolStats = {
  totals: { approved: number; pending: number; rejected: number; merged: number; private: number; public: number; unset: number; needs_review: number; regions: number; districts: number; people_linked: number };
  by_region: RegionStat[]; by_level: Record<SchoolLevel, number>; weekly: { week: string; added: number; decided: number }[]; districts: DistrictCount[];
};
export const adminSchoolStats = (region = "") => rpc<SchoolStats>("qb_school_admin_stats", { p_region: region || null });
export const adminDecideSchool = (id: string, decision: "approve" | "reject" | "merge", note = "", mergeInto: string | null = null, fix: SchoolFix | null = null) =>
  rpc<{ id: string; decision: string; people_updated: number }>("qb_school_admin_decide", { p_id: id, p_decision: decision, p_note: note || null, p_merge_into: mergeInto, p_fix: fix });
export const adminUpdateSchool = (id: string, fix: SchoolFix) => rpc<{ id: string; name: string }>("qb_school_admin_update", { p_id: id, p_fix: fix });
export const adminImportSchools = (rows: unknown[], source: string) => rpc<ImportResult>("qb_school_admin_import", { p_rows: rows, p_source: source });
