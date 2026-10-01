"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listTenants } from "@/lib/api/admin";

export default function AdminTenantsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listTenants().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Tenants</h1>
          <p>QuizBox public and white-label organizations.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-list">
        {rows.map((row) => (
          <div className="qb-row" key={row.id}>
            <div className="qb-row-main">
              <strong>{row.name}</strong>
              <span>{row.code} · {row.tenant_type} · {row.status}</span>
            </div>
            <Link href={`/tenant/${row.id}`} className="qb-btn ghost">
              Open
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
