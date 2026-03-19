// src/app/dashboards/service-catalog/page.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceProduct {
  id: string;
  name: string | null;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  sellPrice: number | null;
  isActive: boolean;
  zohoItemId: string | null;
  category: string;
}

interface ProductsResponse {
  skus: ServiceProduct[];
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_ROLES = ["ADMIN"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServiceCatalogPage() {
  const { data: session } = useSession();

  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | undefined>(undefined);

  // Filter state
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // Role check
  const userRole =
    (session?.user as { role?: string } | undefined)?.role ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // When showInactive is true, pass active=false so API returns both active
      // and inactive. When false (default), pass active=true (active only).
      const activeParam = showInactive ? "false" : "true";
      const url = `/api/inventory/products?category=SERVICE&active=${activeParam}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch service catalog (${res.status})`);
      }
      const data: ProductsResponse = await res.json();
      setProducts(data.skus ?? []);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // ---------------------------------------------------------------------------
  // Client-side filtering
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
    );
  }, [products, search]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const displayName = (p: ServiceProduct) =>
    p.name ?? `${p.brand} ${p.model}`.trim();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DashboardShell
      title="Service Catalog"
      accentColor="cyan"
      lastUpdated={lastUpdated}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Toolbar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by name, brand, model, or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-t-border bg-surface-2 text-foreground placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </div>

        {/* Show Inactive toggle */}
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="accent-cyan-500"
          />
          Show Inactive
        </label>

        {/* Add Product (admin only) */}
        {isAdmin && (
          <Link
            href="/dashboards/catalog/new?category=SERVICE"
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            + Add Product
          </Link>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* States                                                               */}
      {/* ------------------------------------------------------------------ */}
      {loading && (
        <LoadingSpinner color="cyan" message="Loading service catalog…" />
      )}

      {!loading && error && (
        <ErrorState message={error} onRetry={fetchProducts} color="cyan" />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Table                                                                */}
      {/* ------------------------------------------------------------------ */}
      {!loading && !error && (
        <>
          {/* Row count */}
          <p className="text-sm text-muted mb-3">
            {filteredProducts.length} product
            {filteredProducts.length !== 1 ? "s" : ""}
            {search.trim() ? " matching search" : ""}
            {showInactive ? " (including inactive)" : ""}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-muted">
              No service products found.
            </div>
          ) : (
            <div className="bg-surface rounded-xl border border-t-border shadow-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border">
                    <th className="text-left px-4 py-3 text-muted font-medium">
                      Name
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden sm:table-cell">
                      Brand / Model
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden md:table-cell">
                      Description
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden lg:table-cell">
                      SKU
                    </th>
                    <th className="text-right px-4 py-3 text-muted font-medium">
                      Sell Price
                    </th>
                    <th className="text-center px-4 py-3 text-muted font-medium">
                      Status
                    </th>
                    {isAdmin && (
                      <th className="text-right px-4 py-3 text-muted font-medium">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-t-border">
                  {filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={`hover:bg-surface-2 transition-colors${
                        !product.isActive ? " opacity-50" : ""
                      }`}
                    >
                      {/* Name */}
                      <td className="px-4 py-3 text-foreground font-medium">
                        {displayName(product)}
                      </td>

                      {/* Brand / Model */}
                      <td className="px-4 py-3 text-muted hidden sm:table-cell">
                        {product.brand}
                        {product.brand && product.model ? " / " : ""}
                        {product.model}
                      </td>

                      {/* Description */}
                      <td className="px-4 py-3 text-muted hidden md:table-cell max-w-xs truncate">
                        {product.description ?? "—"}
                      </td>

                      {/* SKU */}
                      <td className="px-4 py-3 text-muted font-mono text-xs hidden lg:table-cell">
                        {product.sku ?? "—"}
                      </td>

                      {/* Sell Price */}
                      <td className="px-4 py-3 text-right text-foreground">
                        {product.sellPrice != null
                          ? formatCurrency(product.sellPrice)
                          : "—"}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        {product.isActive ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/20 text-zinc-400">
                            Inactive
                          </span>
                        )}
                      </td>

                      {/* Actions (admin only) */}
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/dashboards/catalog/edit/${product.id}`}
                            className="text-cyan-500 hover:text-cyan-400 text-xs font-medium transition-colors"
                          >
                            Edit
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
