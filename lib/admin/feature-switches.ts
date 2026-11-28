// The list behind Admin > Feature switches. Each switch is one row in public.platform_settings (key "flags.<name>", scope global, value true/false),
// read by the database functions and screens of that feature. Turning a switch off hides or closes the feature; turning it back on restores it
// with nothing lost, because no switch deletes data. A switch that exists in the database but not in this list still appears, under "Other switches",
// so a newly installed feature can be controlled before this list is updated.

export type SwitchKind = "feature" | "payments" | "safety" | "look";
export type SwitchArea = "Learning" | "Teachers and classes" | "Families and sponsors" | "Challenges and competitions" | "Payments and selling" | "Staff and partners" | "Look and presentation" | "Other switches";

export type SwitchInfo = {
  key: string;            // the setting name, always "flags.<name>"
  name: string;           // what the owner calls it
  area: SwitchArea;
  on: string;             // what people get when it is on
  off: string;            // what happens when it is off
  kind: SwitchKind;       // payments and safety switches ask for an extra confirmation
  requires?: string[];    // other switches that must be on for this one to work
  screenOnly?: boolean;   // read by screens only, with no database part, so it can be set before any migration creates its row
};

export const AREAS: SwitchArea[] = ["Learning", "Teachers and classes", "Families and sponsors", "Challenges and competitions", "Payments and selling", "Staff and partners", "Look and presentation", "Other switches"];

export const FEATURE_SWITCHES: SwitchInfo[] = [
  // Learning
  { key: "flags.offline_learning", name: "Offline learning", area: "Learning", kind: "feature",
    on: "Content marked for offline use may be used without a connection.", off: "Reserved. No screen uses it yet, so it changes nothing today." },
  { key: "flags.school_directory", name: "School directory", area: "Learning", kind: "feature",
    on: "Students and teachers pick their school from the directory and can suggest a missing school for staff approval.", off: "People type their school name as before. The directory and suggestions are hidden." },

  // Teachers and classes
  { key: "flags.repeat_assignments", name: "Repeat assignments", area: "Teachers and classes", kind: "feature",
    on: "Teachers can repeat an assignment every week, and learners get a due-soon reminder.", off: "The repeat option is hidden and no new repeats are published. Existing assignments stay." },
  { key: "flags.teacher_profile_edit", name: "Teachers edit their profile", area: "Teachers and classes", kind: "feature",
    on: "A teacher can edit their own name, school, subjects and classes taught.", off: "The edit option is hidden. Staff can still change a teacher's details." },
  { key: "flags.mock_exams", name: "Mock exams", area: "Teachers and classes", kind: "feature",
    on: "Teachers and verified sponsors build mock exams from several years, assign them, read results and export them.", off: "Mock exams disappear from menus and cannot be started. Saved exams and results are kept." },
  { key: "flags.mock_exam_links", name: "Mock exam links", area: "Teachers and classes", kind: "feature", requires: ["flags.mock_exams"],
    on: "Sponsors share a mock exam by link for a number of places paid in Coins.", off: "Links stop opening and no new links can be made. Paid places are kept." },

  // Families and sponsors
  { key: "flags.family_workspace", name: "Family workspace", area: "Families and sponsors", kind: "feature",
    on: "Parents and sponsors link or add children, give them work and buy for them.", off: "The Family workspace disappears from the menu and family actions are refused. Families and links are kept." },
  { key: "flags.guardian_consent_required", name: "Guardian links need consent", area: "Families and sponsors", kind: "safety",
    on: "A guardian link waits for the learner or guardian to accept before it works.", off: "A guardian link works without that acceptance." },
  { key: "flags.sponsor_consent_required", name: "Sponsor links need consent", area: "Families and sponsors", kind: "safety",
    on: "A sponsor link waits for the learner (or their guardian) to accept before it works. Keep this on.", off: "A sponsor link works without the learner's acceptance. Only for testing." },

  // Challenges and competitions
  { key: "flags.paid_challenges", name: "Paid challenge places", area: "Challenges and competitions", kind: "payments",
    on: "Open challenges give a few free places, then sponsors pay for more.", off: "Challenges have no paid places, as before." },
  { key: "flags.sponsor_school_aiming", name: "Sponsored challenge for one school", area: "Challenges and competitions", kind: "feature",
    on: "Staff may aim a sponsored challenge at one verified school.", off: "Sponsored challenges are aimed as before." },
  { key: "flags.interschool", name: "Inter-school competitions", area: "Challenges and competitions", kind: "feature",
    on: "Organisers run inter-school competitions: school registration, rounds and results.", off: "Inter-school screens disappear and actions are refused. Competitions and results are kept." },
  { key: "flags.interschool_public", name: "Inter-school public pages", area: "Challenges and competitions", kind: "feature", requires: ["flags.interschool"],
    on: "Public competition pages, campaign links, QR codes and results are visible to everyone.", off: "Public pages and links show nothing. Organisers still see their competitions." },
  { key: "flags.interschool_sponsorship", name: "Inter-school sponsorship", area: "Challenges and competitions", kind: "payments", requires: ["flags.interschool"],
    on: "Sponsors get quotations and invoices and can pay online for inter-school competitions.", off: "No new invoices or payments. Paid invoices are kept." },
  { key: "flags.interschool_certificates", name: "Inter-school certificates", area: "Challenges and competitions", kind: "feature", requires: ["flags.interschool"],
    on: "Learners and schools get certificates for inter-school competitions.", off: "No new certificates are issued. Issued ones are kept." },

  // Payments and selling
  { key: "flags.buy_coins_enabled", name: "Buy Coins", area: "Payments and selling", kind: "payments",
    on: "People can start a Coin purchase.", off: "Buying Coins is closed. Balances are kept and can still be spent." },
  { key: "flags.student_self_pay", name: "Learners pay for themselves", area: "Payments and selling", kind: "payments", requires: ["flags.buy_coins_enabled"],
    on: "Learners can pay online for themselves.", off: "Learners cannot pay; a parent, sponsor or school pays for them." },
  { key: "flags.marketplace", name: "Marketplace", area: "Payments and selling", kind: "payments",
    on: "Teachers sell question sets and buyers can buy them.", off: "The Marketplace shows nothing and sales are refused. Purchases already made stay usable." },
  { key: "flags.affiliates", name: "Affiliate programme", area: "Payments and selling", kind: "payments",
    on: "People apply as affiliates, share referral codes and earn commission.", off: "Applications and new commission stop. Earned commission is kept." },
  { key: "flags.affiliate_payouts", name: "Affiliate payouts", area: "Payments and selling", kind: "payments", requires: ["flags.affiliates"],
    on: "Affiliates may request payouts.", off: "Payout requests are closed. What is owed is kept." },

  // Staff and partners
  { key: "flags.staff_access", name: "Staff access", area: "Staff and partners", kind: "feature",
    on: "A super admin gives colleagues connected admin workflows by email, and their menu follows.", off: "Given workflows stop working and the Staff access page is hidden. Assignments are kept." },
  { key: "flags.partner_access_gateway_v1", name: "Partner gateway", area: "Staff and partners", kind: "feature",
    on: "Partner licences, partner sign-in and the partner API are open.", off: "Partner access stops at once. Contracts and seats are kept." },
  { key: "flags.social_channels", name: "Social channels", area: "Staff and partners", kind: "feature",
    on: "The Follow QuizBox corner shows the channels managed in Admin > Social channels.", off: "The app shows its built-in list of channels." },
  { key: "flags.careers", name: "Careers", area: "Staff and partners", kind: "feature",
    on: "The public careers page, footer link and job applications are open.", off: "The careers page and link are hidden. Applications are kept." },

  // Look and presentation (screens only)
  { key: "flags.q_insignia_subject_cards_v02", name: "Subject photo cards", area: "Look and presentation", kind: "look", screenOnly: true,
    on: "Subjects show as photo cards.", off: "Subjects show as the earlier chips and lists. Nothing is lost." },
  { key: "flags.q_insignia_concept_photos", name: "Concept photos (review only)", area: "Look and presentation", kind: "look", screenOnly: true, requires: ["flags.q_insignia_subject_cards_v02"],
    on: "Photo cards may use photos not yet approved. Never on in Production until the photos are cleared.", off: "Only approved photos are shown." },
  { key: "flags.design_v02_help", name: "New Help page design", area: "Look and presentation", kind: "look", screenOnly: true,
    on: "The Help page uses the new presentation.", off: "The Help page uses the earlier presentation." },
];

export type SettingRow = { key: string; value: unknown; description?: string | null; updated_at?: string | null };

export type SwitchState = SwitchInfo & {
  installed: boolean;     // a row exists in this database
  value: boolean | null;  // null when not installed or not a true/false value
  updatedAt: string | null;
  canChange: boolean;
};

const byKey = new Map(FEATURE_SWITCHES.map((s) => [s.key, s]));
export const switchInfo = (key: string): SwitchInfo | undefined => byKey.get(key);

// A readable name for a switch the list does not know yet: "flags.new_thing_v2" becomes "New thing v2".
export function nameFromKey(key: string): string {
  const words = key.replace(/^flags\./, "").replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

// The known list, plus every switch found in the database, with what the database says about each.
export function buildSwitchList(rows: SettingRow[]): SwitchState[] {
  const found = new Map(rows.filter((r) => r.key.startsWith("flags.")).map((r) => [r.key, r]));
  const known: SwitchState[] = FEATURE_SWITCHES.map((s) => {
    const row = found.get(s.key);
    const value = row && typeof row.value === "boolean" ? row.value : null;
    return { ...s, installed: !!row, value, updatedAt: row?.updated_at ?? null, canChange: !!row || !!s.screenOnly };
  });
  const others: SwitchState[] = [...found.values()].filter((r) => !byKey.has(r.key)).sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({
    key: r.key, name: nameFromKey(r.key), area: "Other switches", kind: "feature",
    on: r.description?.trim() || "No description saved for this switch.", off: "The feature behind it is switched off.",
    installed: true, value: typeof r.value === "boolean" ? r.value : null, updatedAt: r.updated_at ?? null, canChange: true,
  }));
  return [...known, ...others];
}

// Why a change should not go ahead (empty when it can), and what else it affects.
export function checkChange(target: SwitchState, turnOn: boolean, all: SwitchState[]): { blocked: string[]; affects: string[] } {
  const on = (key: string) => all.find((s) => s.key === key)?.value === true;
  const nameOf = (key: string) => all.find((s) => s.key === key)?.name ?? nameFromKey(key);
  const blocked: string[] = [];
  if (!target.canChange) blocked.push("This feature is not installed on this database yet. Its migrations must be applied first.");
  if (turnOn) for (const need of target.requires ?? []) if (!on(need)) blocked.push(`Turn on "${nameOf(need)}" first.`);
  const affects = turnOn ? [] : all.filter((s) => s.value === true && (s.requires ?? []).includes(target.key)).map((s) => s.name);
  return { blocked, affects };
}

export const needsExtraCare = (s: SwitchInfo) => s.kind === "payments" || s.kind === "safety";
