"use client";

import { useEffect, useId, useState } from "react";
import { listCurricula, listCurriculumNodes } from "@/lib/api/curriculum";

export interface CurriculumSelection {
  curriculumId: string;
  educationLevel: string;
  gradeCode: string;
  subjectNodeId: string;
  subjectCode: string;
}

export function CurriculumSelector({ value, onChange }: { value: Partial<CurriculumSelection>; onChange: (value: Partial<CurriculumSelection>) => void }) {
  const id = useId();
  const [curricula, setCurricula] = useState<any[]>([]);
  const [levels, setLevels] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [levelId, setLevelId] = useState("");
  const [gradeId, setGradeId] = useState("");

  useEffect(() => { listCurricula().then(setCurricula).catch(() => setCurricula([])); }, []);
  useEffect(() => {
    if (!value.curriculumId) return setLevels([]);
    listCurriculumNodes({ curriculumId: value.curriculumId, nodeType: "education_level", parentId: null }).then(setLevels);
  }, [value.curriculumId]);
  useEffect(() => {
    if (!value.curriculumId || !levelId) return setGrades([]);
    listCurriculumNodes({ curriculumId: value.curriculumId, nodeType: "grade", parentId: levelId }).then(setGrades);
  }, [value.curriculumId, levelId]);
  useEffect(() => {
    if (!value.curriculumId || !gradeId) return setSubjects([]);
    listCurriculumNodes({ curriculumId: value.curriculumId, nodeType: "subject", parentId: gradeId }).then(setSubjects);
  }, [value.curriculumId, gradeId]);

  return <div className="qb-grid cols-2">
    <div className="qb-field"><label htmlFor={id + "-curriculum"}>Curriculum</label><select id={id + "-curriculum"} value={value.curriculumId ?? ""} onChange={(event) => { setLevelId(""); setGradeId(""); onChange({ curriculumId: event.target.value }); }} required><option value="">Select curriculum</option>{curricula.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.version})</option>)}</select></div>
    <div className="qb-field"><label htmlFor={id + "-level"}>Education level</label><select id={id + "-level"} value={levelId} onChange={(event) => { const node = levels.find((row) => row.id === event.target.value); setLevelId(event.target.value); setGradeId(""); onChange({ ...value, educationLevel: node?.title, gradeCode: undefined, subjectNodeId: undefined }); }} required><option value="">Select level</option>{levels.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></div>
    <div className="qb-field"><label htmlFor={id + "-grade"}>Grade / form</label><select id={id + "-grade"} value={gradeId} onChange={(event) => { const node = grades.find((row) => row.id === event.target.value); setGradeId(event.target.value); onChange({ ...value, gradeCode: node?.title, subjectNodeId: undefined }); }} required><option value="">Select grade</option>{grades.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></div>
    <div className="qb-field"><label htmlFor={id + "-subject"}>Subject</label><select id={id + "-subject"} value={value.subjectNodeId ?? ""} onChange={(event) => { const node = subjects.find((row) => row.id === event.target.value); onChange({ ...value, subjectNodeId: node?.id, subjectCode: node?.code, gradeCode: node?.grade_code ?? value.gradeCode }); }} required><option value="">Select subject</option>{subjects.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></div>
  </div>;
}
