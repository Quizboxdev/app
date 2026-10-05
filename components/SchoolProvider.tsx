"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSchoolHistory, getSchoolOverview, getSchoolPerformance, listMySchools, type SchoolHistoryRow, type SchoolOverview, type SchoolPerformance, type SchoolRef } from "@/lib/api/school";

// performance is null when the school-performance contract is not available on the server.
type SchoolData = { school: SchoolRef; overview: SchoolOverview; history: SchoolHistoryRow[]; performance: SchoolPerformance | null; reload: () => Promise<void> };
const Ctx = createContext<SchoolData | null>(null);
const STORE_KEY = "qb-school-id";

export function useSchool() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSchool must be used inside SchoolProvider");
  return value;
}

// Loads the administered school(s) once for every /school page; pages stay thin and only render once data exists.
export default function SchoolProvider({ children }: { children: ReactNode }) {
  const [schools, setSchools] = useState<SchoolRef[] | null>(null), [schoolId, setSchoolId] = useState("");
  const [data, setData] = useState<{ overview: SchoolOverview; history: SchoolHistoryRow[]; performance: SchoolPerformance | null } | null>(null), [error, setError] = useState("");

  useEffect(() => {
    listMySchools().then((rows) => {
      let saved = ""; try { saved = sessionStorage.getItem(STORE_KEY) ?? ""; } catch { /* storage is optional */ }
      setSchools(rows); setSchoolId(rows.find((s) => s.id === saved)?.id ?? rows[0]?.id ?? "");
    }).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async (id: string) => {
    const [overview, history, performance] = await Promise.all([getSchoolOverview(id), getSchoolHistory(id), getSchoolPerformance(id)]);
    setData({ overview, history, performance });
  }, []);
  useEffect(() => { if (schoolId) { setData(null); load(schoolId).catch((e) => setError(e.message)); } }, [schoolId, load]);

  const school = schools?.find((s) => s.id === schoolId);
  const value = useMemo(() => school && data ? { school, ...data, reload: () => load(school.id) } : null, [school, data, load]);

  function choose(id: string) { setSchoolId(id); try { sessionStorage.setItem(STORE_KEY, id); } catch { /* storage is optional */ } }

  if (error) return <p className="qb-card qb-error" role="alert">{error}</p>;
  if (schools === null || (schoolId && !value)) return <div className="qb-home-grid" aria-busy="true" role="status"><span className="qb-sr-only">Loading school…</span>{[1, 2, 3].map((i) => <div key={i} className="qb-card qb-skeleton" />)}</div>;
  if (!schools.length) return <>
    <div className="qb-page-head"><div><h1>School</h1><p>Classes, teachers and learners for institutions you administer.</p></div></div>
    <div className="qb-card qb-empty"><strong>No school linked to your account</strong>School administrators see their classes, teachers and learners here. Ask your school or QuizBox support to add you as an institution administrator.</div>
  </>;
  return <Ctx.Provider value={value}>
    {schools.length > 1 && <div className="qb-content-filters"><div className="qb-field"><label htmlFor="school-picker">School</label>
      <select id="school-picker" value={schoolId} onChange={(e) => choose(e.target.value)}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div></div>}
    {children}
  </Ctx.Provider>;
}
