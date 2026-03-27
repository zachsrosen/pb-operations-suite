// src/app/dashboards/product-catalog/page.tsx
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

interface CatalogProduct {
  id: string;
  name: string | null;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  sellPrice: number | null;
  isActive: boolean;
  category: string;
  unitSpec: number | null;
  unitLabel: string | null;
}

interface ProductsResponse {
  skus: CatalogProduct[];
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_ROLES = ["ADMIN"];

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Categories" },
  { value: "MODULE", label: "Modules" },
  { value: "INVERTER", label: "Inverters" },
  { value: "BATTERY", label: "Batteries" },
  { value: "BATTERY_EXPANSION", label: "Battery Expansion" },
  { value: "EV_CHARGER", label: "EV Chargers" },
  { value: "RAPID_SHUTDOWN", label: "Rapid Shutdown" },
  { value: "RACKING", label: "Racking" },
  { value: "ELECTRICAL_BOS", label: "Electrical BOS" },
  { value: "MONITORING", label: "Monitoring" },
  { value: "OPTIMIZER", label: "Optimizers" },
  { value: "GATEWAY", label: "Gateways" },
  { value: "D_AND_R", label: "D&R" },
  { value: "SERVICE", label: "Service" },
  { value: "ADDER_SERVICES", label: "Adder Services" },
  { value: "TESLA_SYSTEM_COMPONENTS", label: "Tesla System Components" },
  { value: "PROJECT_MILESTONES", label: "Project Milestones" },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label])
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProductCatalogPage() {
  const { data: session } = useSession();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | undefined>(undefined);

  // Filter state
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
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
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      params.set("active", showInactive ? "false" : "true");
      params.set("limit", "2000");

      const res = await fetch(`/api/inventory/products?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch product catalog (${res.status})`);
      }
      const data: ProductsResponse = await res.json();
      setProducts(data.skus ?? []);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [category, showInactive]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // ---------------------------------------------------------------------------
  // Client-side search filtering
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }, [products, search]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const displayName = (p: CatalogProduct) =>
    p.name ?? `${p.brand} ${p.model}`.trim();

  const specLabel = (p: CatalogProduct) => {
    if (p.unitSpec == null) return null;
    return `${p.unitSpec}${p.unitLabel ?? ""}`;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DashboardShell
      title="Product Catalog"
      accentColor="orange"
      lastUpdated={lastUpdated}
    >
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by name, brand, model, SKU, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-t-border bg-surface-2 text-foreground placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          />
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border border-t-border bg-surface-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Show Inactive toggle */}
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="accent-orange-500"
          />
          Show Inactive
        </label>

        {/* Add Product (admin only) */}
        {isAdmin && (
          <Link
            href="/dashboards/catalog/new"
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            + Add Product
          </Link>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <LoadingSpinner color="orange" message="Loading product catalog…" />
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState message={error} onRetry={fetchProducts} color="orange" />
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {/* Row count */}
          <p className="text-sm text-muted mb-3">
            {filteredProducts.length} product
            {filteredProducts.length !== 1 ? "s" : ""}
            {search.trim() ? " matching search" : ""}
            {category ? ` in ${CATEGORY_LABELS[category] ?? category}` : ""}
            {showInactive ? " (including inactive)" : ""}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-muted">
              No products found.
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
                      Category
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden md:table-cell">
                      Brand / Model
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden lg:table-cell">
                      Spec
                    </th>
                    <th className="text-left px-4 py-3 text-muted font-medium hidden lg:table-cell">
                      SKU
                    </th>
                    <th className="text-right px-4 py-3 text-muted font-medium">
                      Price
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
                      <td className="px-4 py-3 text-foreground font-medium">
                        {displayName(product)}
                      </td>

                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400">
                          {CATEGORY_LABELS[product.category] ?? product.category}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-muted hidden md:table-cell">
                        {product.brand}
                        {product.brand && product.model ? " / " : ""}
                        {product.model}
                      </td>

                      <td className="px-4 py-3 text-muted hidden lg:table-cell font-mono text-xs">
                        {specLabel(product) ?? "—"}
                      </td>

                      <td className="px-4 py-3 text-muted font-mono text-xs hidden lg:table-cell">
                        {product.sku ?? "—"}
                      </td>

                      <td className="px-4 py-3 text-right text-foreground">
                        {product.sellPrice != null
                          ? formatCurrency(product.sellPrice)
                          : "—"}
                      </td>

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

                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/dashboards/catalog/edit/${product.id}`}
                            className="text-orange-500 hover:text-orange-400 text-xs font-medium transition-colors"
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
