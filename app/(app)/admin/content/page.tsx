"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { getContentHealth, getQuestionDistribution } from "@/lib/api/admin";

export default function AdminContentPage() {
  const [health, setHealth] = useState<any>(null);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getContentHealth(), getQuestionDistribution()])
      .then(([h, d]) => {
        setHealth(h);
        setDistribution(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!health) return <div>Loading content analytics…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Content Health</h1>
          <p>Curriculum coverage and content-quality indicators.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={health.total_questions ?? 0} label="Total questions" />
        <StatCard value={health.active_questions ?? 0} label="Active questions" />
        <StatCard value={health.rich_content_questions ?? 0} label="Rich questions" />
        <StatCard value={health.question_banks ?? 0} label="Question banks" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-card">
        <h2>Quality exceptions</h2>
        <div className="qb-grid cols-4">
          <StatCard value={health.missing_curriculum_indicator ?? 0} label="Missing indicator" />
          <StatCard value={health.missing_explanation ?? 0} label="Missing explanation" />
          <StatCard value={health.missing_external_id ?? 0} label="Missing external ID" />
          <StatCard value={health.image_or_media_questions ?? 0} label="Media questions" />
        </div>
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-card qb-table-wrap">
        <h2>Question distribution</h2>
        <table className="qb-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Grade</th>
              <th>Questions</th>
            </tr>
          </thead>
          <tbody>
            {distribution.map((row, i) => (
              <tr key={`${row.subject_code}-${row.grade}-${i}`}>
                <td>{row.subject_code}</td>
                <td>{row.grade}</td>
                <td>{row.question_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
