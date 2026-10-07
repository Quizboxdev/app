"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { completeOnboarding, listSignupCountries, type OnboardingRole, type SignupCountry } from "@/lib/api/markets";
import { userFacingError } from "@/lib/errors";
import { recordFailure } from "@/lib/api/operations";
import BrandLockup from "@/components/BrandLockup";

// Country → role → role-specific details. Options come from the selected market's configuration.
export default function OnboardingPage() {
  const router = useRouter();
  const [countries, setCountries] = useState<SignupCountry[]>([]);
  const [countryCode, setCountryCode] = useState(""), [role, setRole] = useState<OnboardingRole>("student"), [fullName, setFullName] = useState("");
  const [level, setLevel] = useState(""), [grade, setGrade] = useState(""), [school, setSchool] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [org, setOrg] = useState({ organization_name: "", contact_name: "", contact_email: "", contact_phone: "" });
  const [applySme, setApplySme] = useState(false), [qualifications, setQualifications] = useState(""), [years, setYears] = useState("0");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseBrowserClient().auth.getUser();
      if (!data.user) { router.replace("/login"); return; }
      const meta = data.user.user_metadata ?? {};
      setFullName(String(meta.full_name ?? "")); setCountryCode(String(meta.country_code ?? "")); if (["student", "teacher", "sponsor"].includes(meta.role)) setRole(meta.role);
      // Set by the public "Apply to become a QuizBox SME" link; only pre-ticks the approval-controlled option.
      if (meta.role === "teacher" && meta.sme_intent === true) setApplySme(true);
      setOrg((current) => ({ ...current, contact_email: data.user?.email ?? "" }));
      setCountries(await listSignupCountries());
    })().catch((cause) => setError(userFacingError(cause)));
  }, [router]);

  const country = countries.find((c) => c.country_code === countryCode);
  const levelGrades = useMemo(() => (country?.grades ?? []).filter((g) => !level || g.level === level), [country, level]);
  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const checks = (options: Array<{ code: string; label: string }>, list: string[], set: (v: string[]) => void, name: string) =>
    <fieldset className="qb-content-filters"><legend>{name}</legend>{options.map((o) => <label key={o.code}><input type="checkbox" checked={list.includes(o.code)} onChange={() => toggle(list, set, o.code)}/>{o.label}</label>)}</fieldset>;

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      if (!country?.available) throw new Error("QB_COUNTRY_NOT_AVAILABLE");
      await completeOnboarding({
        country_code: countryCode, role, full_name: fullName, school_name: school,
        ...(role === "student" ? { education_level: level, grade_code: grade, subjects } : {}),
        ...(role === "teacher" ? { subjects, apply_sme: applySme, qualifications, years_experience: Number(years) } : {}),
        ...(role === "sponsor" ? org : {}),
      });
      const ctx = await bootstrapUser();
      router.replace(getHomeRouteForRole(String(ctx.role)));
    } catch (cause) { void recordFailure("ONBOARDING", cause).catch(() => undefined); setError(userFacingError(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="qb-auth">
      <div className="qb-auth-card">
        <BrandLockup variant="responsive" href="/" size={36} />
        <p className="qb-muted">Set up your account</p>
        <form className="qb-form" onSubmit={submit}>
          <div className="qb-field"><label htmlFor="ob-name">Full name</label><input id="ob-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required/></div>
          <div className="qb-field"><label htmlFor="ob-country">Country</label>
            <select id="ob-country" value={countryCode} onChange={(e) => { setCountryCode(e.target.value); setLevel(""); setGrade(""); setSubjects([]); }} required>
              <option value="">Select your country</option>{countries.map((c) => <option key={c.country_code} value={c.country_code}>{c.country}</option>)}
            </select>
            {country && !country.available && <div className="qb-error" role="alert">QuizBox is not yet available in this country.</div>}
          </div>
          <div className="qb-field"><label htmlFor="ob-role">I am a</label>
            <select id="ob-role" value={role} onChange={(e) => setRole(e.target.value as OnboardingRole)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="sponsor">Sponsor / organization</option></select>
          </div>
          {country?.available && role === "student" && <>
            <div className="qb-field"><label htmlFor="ob-level">Education level</label><select id="ob-level" value={level} required onChange={(e) => { setLevel(e.target.value); setGrade(""); }}><option value="">Select education level</option>{country.education_levels.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
            <div className="qb-field"><label htmlFor="ob-grade">Grade / class</label><select id="ob-grade" value={grade} disabled={!level} onChange={(e) => setGrade(e.target.value)} required><option value="">{level ? "Select grade / class" : "Select education level first"}</option>{levelGrades.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}</select></div>
            {checks(country.subjects, subjects, setSubjects, "Subjects")}
          </>}
          {country?.available && role === "teacher" && <>
            {checks(country.subjects, subjects, setSubjects, "Subjects taught")}
            <label><input type="checkbox" checked={applySme} onChange={(e) => setApplySme(e.target.checked)}/>Apply to review content as a subject-matter expert (requires approval)</label>
            {applySme && <><div className="qb-field"><label htmlFor="ob-qual">Qualifications</label><textarea id="ob-qual" value={qualifications} onChange={(e) => setQualifications(e.target.value)}/></div>
              <div className="qb-field"><label htmlFor="ob-years">Years of experience</label><input id="ob-years" type="number" min={0} value={years} onChange={(e) => setYears(e.target.value)}/></div></>}
          </>}
          {country?.available && role !== "sponsor" && <div className="qb-field"><label htmlFor="ob-school">{role === "teacher" ? "School / institution" : "School / institution (optional)"}</label><input id="ob-school" value={school} onChange={(e) => setSchool(e.target.value)} required={role === "teacher"}/></div>}
          {country?.available && role === "sponsor" && <>
            <div className="qb-field"><label htmlFor="ob-org">Organization name</label><input id="ob-org" value={org.organization_name} onChange={(e) => setOrg({ ...org, organization_name: e.target.value })} required/></div>
            <div className="qb-field"><label htmlFor="ob-contact">Contact name</label><input id="ob-contact" value={org.contact_name} onChange={(e) => setOrg({ ...org, contact_name: e.target.value })}/></div>
            <div className="qb-field"><label htmlFor="ob-email">Contact email</label><input id="ob-email" type="email" value={org.contact_email} onChange={(e) => setOrg({ ...org, contact_email: e.target.value })} required/></div>
          </>}
          {error && <div role="alert" className="qb-error">{error}</div>}
          <button className="qb-btn" type="submit" disabled={busy || !country?.available}>{busy ? "Saving…" : "Continue"}</button>
        </form>
      </div>
    </div>
  );
}
