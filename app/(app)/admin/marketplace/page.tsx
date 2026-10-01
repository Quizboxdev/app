"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { getMarketplaceMetrics } from "@/lib/api/admin";

export default function AdminMarketplacePage() {
  const [m, setM] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getMarketplaceMetrics()
      .then(setM)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!m) return <div>Loading marketplace metrics…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Marketplace</h1>
          <p>Seller, product and entitlement economics. Payment gateways remain disabled.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={m.sellers?.total ?? 0} label="Sellers" />
        <StatCard value={m.products?.published ?? 0} label="Published products" />
        <StatCard value={m.orders?.total ?? 0} label="Orders recorded" />
        <StatCard value={m.seller_economics?.seller_net ?? 0} label="Seller net value" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-card">
        <strong>Current commercial mode:</strong>{" "}
        Marketplace catalogue + manual entitlement management.
        Automated payment settlement is intentionally excluded.
      </div>
    </>
  );
}
