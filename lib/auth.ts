import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { UserContext } from "@/lib/types";

export function getHomeRouteForRole(role: string) {
  switch (role.toUpperCase()) {
    case "ADMIN":
    case "OWNER":
      return "/admin";
    case "TEACHER":
      return "/teacher";
    case "SPONSOR":
      return "/sponsor";
    default:
      return "/student";
  }
}

export async function bootstrapUser(): Promise<UserContext> {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) throw new Error("PROFILE_NOT_FOUND");

  const role = String((profile as any).role ?? "STUDENT").toUpperCase();

  let studentProfile: Record<string, unknown> | null = null;
  let teacherProfile: Record<string, unknown> | null = null;

  if (role === "STUDENT") {
    const { data, error } = await supabase
      .from("student_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    studentProfile = data;
  }

  if (["TEACHER", "ADMIN", "OWNER"].includes(role)) {
    const { data, error } = await supabase
      .from("teacher_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    teacherProfile = data;
  }

  return {
    userId: user.id,
    role,
    profile,
    studentProfile,
    teacherProfile,
  };
}

export async function signOut() {
  const supabase = getSupabaseBrowserClient();
  await supabase.auth.signOut();
}
