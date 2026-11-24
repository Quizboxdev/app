// The pages a signed-in role may open before any extra duties (reviewer, finance, staff) are read. Duties only ADD pages, so a path outside this list
// may still be allowed later; a path inside it is allowed at once. The shell uses this to avoid flashing a page the person will be sent away from.
const SHARED = ["/account", "/notifications", "/school", "/play", "/open", "/drafts", "/support", "/guides", "/affiliate", "/mock-exams/join"];
const BY_ROLE: Record<string, string[]> = {
  ADMIN: ["/admin", "/teacher", "/practise", "/student/attempt", "/competition", "/marketplace", "/subscribe", "/creator", "/mock-exams"],
  TEACHER: ["/teacher", "/practise", "/student/attempt", "/competition", "/marketplace", "/seller", "/subscribe", "/creator", "/mock-exams"],
  SPONSOR: ["/sponsor", "/competition", "/marketplace", "/seller", "/creator", "/mock-exams"],
};
const STUDENT = ["/student", "/learn", "/practise", "/competition", "/marketplace", "/subscribe", "/creator"];

export function baseRoutePrefixes(role: string, familyOn: boolean): string[] {
  const r = String(role).toUpperCase() === "OWNER" ? "ADMIN" : String(role).toUpperCase();
  const own = BY_ROLE[r] ?? STUDENT;
  const family = r !== "STUDENT" && familyOn ? ["/family"] : [];
  return [...own, ...SHARED, ...family];
}

export const underPrefix = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(`${prefix}/`);
export const isBaseRoute = (role: string, pathname: string, familyOn: boolean): boolean => baseRoutePrefixes(role, familyOn).some((p) => underPrefix(pathname, p));
