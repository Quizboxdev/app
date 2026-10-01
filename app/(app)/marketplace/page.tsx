"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import {
  listMarketplaceProducts,
  listMyEntitlements,
} from "@/lib/api/marketplace";

export default function MarketplacePage() {
  const [products, setProducts] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const [p, e] = await Promise.all([
          listMarketplaceProducts(),
          listMyEntitlements(ctx.userId),
        ]);
        setProducts(p);
        setEntitlements(e);
      })
      .catch((e) => setError(e.message));
  }, []);

  const entitledProductIds = new Set(
    entitlements.map((e: any) => e.product_id).filter(Boolean)
  );

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>QuizBox Marketplace</h1>
          <p>
            Teacher and school content catalogue. Payment processing is currently disabled.
          </p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-grid cols-3">
        {products.map((product) => {
          const owned = entitledProductIds.has(product.id);

          return (
            <div className="qb-card" key={product.id}>
              <span className={`qb-pill ${owned ? "success" : ""}`}>
                {owned ? "Access granted" : product.product_type}
              </span>
              <h3 style={{ marginTop: 14 }}>{product.title}</h3>
              <p className="qb-muted">{product.description ?? ""}</p>
              <div>
                <strong>
                  {product.currency} {Number(product.price ?? 0).toFixed(2)}
                </strong>
              </div>
              <div className="qb-small qb-muted" style={{ marginTop: 8 }}>
                {product.seller_display_name ?? "QuizBox seller"}
              </div>
            </div>
          );
        })}
      </div>

      {!products.length && !error && (
        <div className="qb-card qb-muted">No published products yet.</div>
      )}
    </>
  );
}
