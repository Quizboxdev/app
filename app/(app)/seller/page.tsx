"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import {
  findMySeller,
  getSellerDashboard,
  getSellerBalance,
  listSellerProducts,
  listPayouts,
} from "@/lib/api/marketplace";

export default function SellerPage() {
  const [seller, setSeller] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const found = await findMySeller({
          userId: ctx.userId,
          teacherId: (ctx.teacherProfile as any)?.id ?? null,
        });

        if (!found) throw new Error("No marketplace seller profile is linked to this account.");

        setSeller(found);

        const [d, b, p, po] = await Promise.all([
          getSellerDashboard(found.id),
          getSellerBalance(found.id),
          listSellerProducts(found.id),
          listPayouts(found.id),
        ]);

        setDash(d);
        setBalance(b);
        setProducts(p);
        setPayouts(po);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!seller || !dash || !balance) return <div>Loading seller workspace…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{seller.display_name}</h1>
          <p>Seller workspace · {seller.verification_status}</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={dash.products ?? 0} label="Products" />
        <StatCard value={dash.orders ?? 0} label="Orders" />
        <StatCard value={dash.net_earnings ?? 0} label="Net earnings" />
        <StatCard value={balance.withdrawable ?? 0} label="Withdrawable" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>Products</h2>
          <div className="qb-list">
            {products.map((p) => (
              <div className="qb-row" key={p.id}>
                <div className="qb-row-main">
                  <strong>{p.title}</strong>
                  <span>{p.product_type} · {p.status}</span>
                </div>
                <strong>{p.currency} {Number(p.price ?? 0).toFixed(2)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="qb-card">
          <h2>Payout records</h2>
          <div className="qb-list">
            {payouts.map((p) => (
              <div className="qb-row" key={p.id}>
                <div className="qb-row-main">
                  <strong>{p.currency} {Number(p.amount ?? 0).toFixed(2)}</strong>
                  <span>{p.status} · {new Date(p.requested_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
            {!payouts.length && <div className="qb-muted">No payouts yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
