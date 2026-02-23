// src/app/dashboards/catalog/page.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import PushToSystemsModal, { type PushItem } from "@/components/PushToSystemsModal";

type Tab = "skus" | "pending";

interface Sku {
  id: string;
  category: string;
  brand: string;
  model: string;
  unitSpec: number | null;
  unitLabel: string | null;
  isActive: boolean;
  zohoItemId: string | null;
  stockLevels: { location: string; quantityOnHand: number }[];
}

interface PushRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  brand: string;
  model: string;
  description: string;
  category: string;
  unitSpec: string | null;
  unitLabel: string | null;
  systems: string[];
  requestedBy: string;
  dealId: string | null;
  createdAt: string;
}

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const CATEGORIES = ["MODULE", "INVERTER", "BATTERY", "EV_CHARGER"] as const;

export default function CatalogPage() {
  const { data: session } = useSession();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("skus");
  const [skus, setSkus] = useState<Sku[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [pendingPushes, setPendingPushes] = useState<PushRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const [newProductItem, setNewProductItem] = useState<PushItem | null>(null);

  // Fetch SKUs
  const fetchSkus = useCallback(() => {
    setSkuLoading(true);
    fetch("/api/inventory/skus?active=false")
      .then((r) => r.json())
      .then((d: { skus?: Sku[] }) => setSkus(d.skus ?? []))
      .catch(() => addToast({ type: "error", title: "Failed to load SKUs" }))
      .finally(() => setSkuLoading(false));
  }, [addToast]);

  useEffect(() => { fetchSkus(); }, [fetchSkus]);

  // Fetch pending count for badge (runs once)
  useEffect(() => {
    fetch("/api/catalog/push-requests?status=PENDING")
      .then((r) => r.json())
      .then((d: { count?: number }) => setPendingCount(d.count ?? 0))
      .catch(() => { /* silent */ });
  }, []);

  // Fetch pending pushes when tab switches to pending
  const fetchPending = useCallback(() => {
    setPendingLoading(true);
    fetch("/api/catalog/push-requests?status=PENDING")
      .then((r) => r.json())
      .then((d: { pushes?: PushRequest[]; count?: number }) => {
        setPendingPushes(d.pushes ?? []);
        setPendingCount(d.count ?? 0);
      })
      .catch(() => addToast({ type: "error", title: "Failed to load pending requests" }))
      .finally(() => setPendingLoading(false));
  }, [addToast]);

  useEffect(() => {
    if (tab === "pending") fetchPending();
  }, [tab, fetchPending]);

  const filtered = useMemo(() => {
    return skus.filter((s) => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return s.brand.toLowerCase().includes(q) || s.model.toLowerCase().includes(q);
      }
      return true;
    });
  }, [skus, categoryFilter, search]);

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/catalog/push-requests/${id}/approve`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error);
      setPendingPushes((prev) => prev.filter((p) => p.id !== id));
      setPendingCount((c) => Math.max(0, c - 1));
      addToast({ type: "success", title: "Approved and pushed to selected systems" });
      // Refresh SKUs if internal was pushed
      fetchSkus();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Approval failed" });
    }
  }

  async function handleReject(id: string) {
    try {
      const res = await fetch(`/api/catalog/push-requests/${id}/reject`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error);
      setPendingPushes((prev) => prev.filter((p) => p.id !== id));
      setPendingCount((c) => Math.max(0, c - 1));
      addToast({ type: "success", title: "Request rejected" });
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Reject failed" });
    }
  }

  return (
    <DashboardShell title="Equipment Catalog" accentColor="cyan">
      {/* Tabs + Submit button */}
      <div className="flex items-center gap-1 mb-6 border-b border-t-border">
        {(["skus", "pending"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-cyan-500 text-cyan-500"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "skus" ? "Equipment SKUs" : (
              <span className="flex items-center gap-2">
                Pending Approvals
                {pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-cyan-500 text-white text-xs font-bold px-1">
                    {pendingCount}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto pb-px">
          <button
            onClick={() => setNewProductItem({ brand: "", model: "", description: "", category: "" })}
            className="px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors flex items-center gap-1.5"
          >
            + Submit New Product
          </button>
        </div>
      </div>

      {/* SKUs Tab */}
      {tab === "skus" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search brand or model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50 flex-1 min-w-48"
            />
            <span className="ml-auto text-xs text-muted self-center">
              {filtered.length} of {skus.length} SKU{skus.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Table */}
          {skuLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading SKUs…</p>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
              <div className="grid grid-cols-[120px_1fr_1fr_90px_160px_70px] gap-x-3 border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                <span>Category</span>
                <span>Brand</span>
                <span>Model</span>
                <span>Unit</span>
                <span>Sync Status</span>
                <span className="text-right">Stock</span>
              </div>
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">No SKUs found.</div>
              ) : filtered.map((sku) => (
                <div key={sku.id} className="grid grid-cols-[120px_1fr_1fr_90px_160px_70px] gap-x-3 items-center border-b border-t-border last:border-b-0 px-4 py-3 text-sm hover:bg-surface-2 transition-colors">
                  <span className="text-xs text-muted font-medium">{sku.category}</span>
                  <span className="font-medium text-foreground truncate" title={sku.brand}>{sku.brand}</span>
                  <span className="text-muted truncate text-xs" title={sku.model}>{sku.model}</span>
                  <span className="text-muted text-xs">{sku.unitSpec != null ? `${sku.unitSpec}${sku.unitLabel ? ` ${sku.unitLabel}` : ""}` : "—"}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span title="Internal Catalog" className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <span className="text-muted">Int</span>
                    </span>
                    <span title="Zoho" className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sku.zohoItemId ? "bg-green-500" : "bg-red-400"}`} />
                      <span className="text-muted">Zoho</span>
                    </span>
                    <span title="HubSpot (not tracked yet)" className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-zinc-500 flex-shrink-0" />
                      <span className="text-muted">HS</span>
                    </span>
                    <span title="Zuper (not tracked yet)" className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-zinc-500 flex-shrink-0" />
                      <span className="text-muted">Zu</span>
                    </span>
                  </div>
                  <span className="text-xs text-muted text-right">
                    {sku.stockLevels.reduce((sum, l) => sum + l.quantityOnHand, 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Tab */}
      {tab === "pending" && (
        <div>
          {pendingLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading requests…</p>
          ) : pendingPushes.length === 0 ? (
            <div className="rounded-xl border border-t-border bg-surface shadow-card px-8 py-16 text-center">
              <p className="text-lg font-medium text-foreground">No pending requests</p>
              <p className="mt-1 text-sm text-muted">Push requests submitted by the team will appear here.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
              <div className={`grid ${isAdmin ? "grid-cols-[1fr_1fr_140px_100px_120px]" : "grid-cols-[1fr_1fr_140px_100px]"} gap-x-3 border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted`}>
                <span>Item</span>
                <span>Systems</span>
                <span>Requested By</span>
                <span>Date</span>
                {isAdmin && <span>Actions</span>}
              </div>
              {pendingPushes.map((p) => (
                <div key={p.id} className={`grid ${isAdmin ? "grid-cols-[1fr_1fr_140px_100px_120px]" : "grid-cols-[1fr_1fr_140px_100px]"} gap-x-3 items-center border-b border-t-border last:border-b-0 px-4 py-3 text-sm hover:bg-surface-2 transition-colors`}>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{p.brand} — {p.model}</div>
                    <div className="text-xs text-muted truncate">{p.description}</div>
                    <div className="text-xs text-muted/60 mt-0.5">{p.category}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.systems.map((s) => (
                      <span key={s} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/30">
                        {s}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-muted truncate">{p.requestedBy}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(p.id)}
                        className="text-xs text-green-400 hover:text-green-300 hover:underline font-medium transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(p.id)}
                        className="text-xs text-red-400 hover:text-red-300 hover:underline transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted italic">Awaiting admin</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <PushToSystemsModal
        item={newProductItem}
        onClose={() => setNewProductItem(null)}
      />
    </DashboardShell>
  );
}
