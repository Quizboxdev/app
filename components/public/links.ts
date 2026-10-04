import { registerHref } from "@/lib/public/registration-params";

// Every public call to action maps to an existing route or a public entry page that documents
// its own backend status. No route here grants privileges: registration roles are validated
// again by /login and by qb_complete_onboarding.
export const PUBLIC_LINKS = {
  home: "/",
  login: "/login",
  register: registerHref(),
  registerStudent: registerHref({ role: "student" }),
  registerTeacher: registerHref({ role: "teacher" }),
  registerSponsor: registerHref({ role: "sponsor" }),
  registerSme: registerHref({ role: "teacher", intent: "sme" }),
  sponsor: "/join/sponsor",
  sme: "/join/sme",
  school: "/join/school",
  country: "/join/country",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
  // /competition is an authenticated workspace route; anonymous visitors sign in first.
  competitions: "/login",
} as const;
