"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherClasses } from "@/lib/api/teacher";

export default function TeacherClassesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const teacherId = String((ctx.teacherProfile as any)?.id ?? "");
        if (!teacherId) throw new Error("Teacher profile not found.");
        return listTeacherClasses(teacherId);
      })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Classes</h1>
          <p>Your active QuizBox classes.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-list">
        {rows.map((row) => (
          <div className="qb-row" key={row.id}>
            <div className="qb-row-main">
              <strong>{row.class_name ?? "Class"}</strong>
              <span>
                {row.grade ?? ""} · Join code: {row.join_code ?? "—"} ·{" "}
                {row.status ?? ""}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
