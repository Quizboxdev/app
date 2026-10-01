"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listQuestionBanks } from "@/lib/api/teacher";

export default function TeacherQuestionBanksPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => listQuestionBanks(ctx.userId))
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Question Banks</h1>
          <p>Your reusable content collections for assessments and later marketplace publishing.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-list">
        {rows.map((row) => (
          <div className="qb-row" key={row.id}>
            <div className="qb-row-main">
              <strong>{row.title ?? "Question Bank"}</strong>
              <span>
                {row.subject_code ?? ""} · {row.grade ?? ""} ·{" "}
                {row.status ?? ""}
              </span>
            </div>
            <span className="qb-pill">
              {row.marketplace_eligible ? "Marketplace eligible" : "Private"}
            </span>
          </div>
        ))}

        {!rows.length && !error && (
          <div className="qb-card qb-muted">No question banks yet.</div>
        )}
      </div>
    </>
  );
}
