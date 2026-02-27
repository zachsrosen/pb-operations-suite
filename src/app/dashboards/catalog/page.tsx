// src/app/dashboards/catalog/page.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import DeleteSkuModal from "@/components/catalog/DeleteSkuModal";

type Tab = "skus" | "sync" | "pending";

interface SkuSyncHealth {
  internal: boolean;
  zoho: boolean;
  hubspot: boolean;
  zuper: boolean;
  connectedCount: number;
  fullySynced: boolean;
}

interface Sku {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  isActive: boolean;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  syncHealth: SkuSyncHealth;
  stockLevels: { location: string; quantityOnHand: number }[];
}

interface SkuSummary {
  total: number;
  fullySynced: number;
  missingZoho: number;
  missingHubspot: number;
  missingZuper: number;
  withPricing: number;
}

interface CategorySyncStat {
  category: string;
  total: number;
  fullySynced: number;
  hasZoho: number;
  hasHubspot: number;
  hasZuper: number;
  withPricing: number;
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

type ApproveOutcomeStatus = "success" | "failed" | "skipped" | "not_implemented";

interface ApproveSummary {
  selected: number;
  success: number;
  failed: number;
  skipped: number;
  notImplemented: number;
}

interface ApproveResponse {
  error?: string;
  summary?: ApproveSummary;
  outcomes?: Record<string, { status: ApproveOutcomeStatus; message?: string; externalId?: string | null }>;
}

interface SkuEditDraft {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string;
  vendorName: string;
  vendorPartNumber: string;
  unitSpec: string;
  unitLabel: string;
  unitCost: string;
  sellPrice: string;
  zohoItemId: string;
  hubspotProductId: string;
  zuperItemId: string;
  isActive: boolean;
}

interface PushEditDraft {
  id: string;
  brand: string;
  model: string;
  description: string;
  category: string;
  unitSpec: string;
  unitLabel: string;
  systems: string[];
}

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const SYSTEM_OPTIONS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;
const CATEGORIES = FORM_CATEGORIES;

function money(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function marginPercent(cost: number | null, sell: number | null): string {
  if (cost == null || sell == null || sell <= 0) return "—";
  const pct = ((sell - cost) / sell) * 100;
  return `${pct.toFixed(1)}%`;
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function SyncDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span title={label} className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-red-400"}`} />
      <span className="text-muted">{label}</span>
    </span>
  );
}

export default function CatalogPage() {
  const { data: session } = useSession();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("skus");
  const [skus, setSkus] = useState<Sku[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuSummary, setSkuSummary] = useState<SkuSummary>({
    total: 0,
    fullySynced: 0,
    missingZoho: 0,
    missingHubspot: 0,
    missingZuper: 0,
    withPricing: 0,
  });
  const [pendingPushes, setPendingPushes] = useState<PushRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [skuEditDraft, setSkuEditDraft] = useState<SkuEditDraft | null>(null);
  const [savingSkuEdit, setSavingSkuEdit] = useState(false);
  const [editingPushId, setEditingPushId] = useState<string | null>(null);
  const [pushEditDraft, setPushEditDraft] = useState<PushEditDraft | null>(null);
  const [savingPushEdit, setSavingPushEdit] = useState(false);

  const [categoryStats, setCategoryStats] = useState<CategorySyncStat[]>([]);
  const [categoryStatsLoading, setCategoryStatsLoading] = useState(false);

  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);

  const [deleteTarget, setDeleteTarget] = useState<{
    sku: { id: string; category: string; brand: string; model: string };
    warning?: string;
    syncedSystems?: string[];
    pendingCount?: number;
    preflightDone: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch SKUs
  const fetchSkus = useCallback(() => {
    setSkuLoading(true);
    fetch("/api/inventory/skus?active=false")
      .then((r) => r.json())
      .then((d: { skus?: Sku[]; summary?: SkuSummary }) => {
        setSkus(d.skus ?? []);
        setSkuSummary(d.summary ?? {
          total: 0,
          fullySynced: 0,
          missingZoho: 0,
          missingHubspot: 0,
          missingZuper: 0,
          withPricing: 0,
        });
      })
      .catch(() => addToast({ type: "error", title: "Failed to load SKUs" }))
      .finally(() => setSkuLoading(false));
  }, [addToast]);

  useEffect(() => { fetchSkus(); }, [fetchSkus]);

  // Step 1: Open modal immediately, then run preflight (never deletes)
  const handleDeleteClick = useCallback(async (sku: { id: string; category: string; brand: string; model: string }) => {
    setDeleteTarget({ sku, preflightDone: false });
    try {
      const res = await fetch(`/api/inventory/skus/${sku.id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.preflight) {
        setDeleteTarget({
          sku,
          warning: data.warning,
          syncedSystems: data.syncedSystems,
          pendingCount: data.pendingCount,
          preflightDone: true,
        });
      } else {
        addToast({ type: "error", title: data.error || "Failed to check SKU status" });
        setDeleteTarget(null);
      }
    } catch {
      addToast({ type: "error", title: "Failed to check SKU status" });
      setDeleteTarget(null);
    }
  }, [addToast]);

  // Step 2: User confirmed in modal — send force=true
  const handleForceDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory/skus/${deleteTarget.sku.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.status === 200 && data.deleted) {
        setSkus((prev) => prev.filter((s) => s.id !== deleteTarget.sku.id));
        fetchSkus();
        addToast({ type: "success", title: "SKU deleted" });
        setDeleteTarget(null);
        return;
      }
      addToast({ type: "error", title: data.error || "Delete failed" });
    } catch {
      addToast({ type: "error", title: "Delete failed" });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, addToast, fetchSkus]);

  // Fetch pending count for badge (runs once)
  useEffect(() => {
    fetch("/api/catalog/push-requests?status=PENDING")
      .then((r) => r.json())
      .then((d: { count?: number }) => setPendingCount(d.count ?? 0))
      .catch(() => { /* silent */ });
  }, []);

  // Fetch per-category sync stats when sync tab is active
  useEffect(() => {
    if (tab !== "sync") return;
    setCategoryStatsLoading(true);
    fetch("/api/inventory/skus/stats")
      .then((r) => r.json())
      .then((d: { categories?: CategorySyncStat[] }) => {
        setCategoryStats(d.categories ?? []);
      })
      .catch(() => { /* silent — global stats still show from main fetch */ })
      .finally(() => setCategoryStatsLoading(false));
  }, [tab]);

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
        return (
          s.brand.toLowerCase().includes(q) ||
          s.model.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          (s.vendorPartNumber ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [skus, categoryFilter, search]);

  const unsynced = useMemo(
    () => filtered.filter((sku) => !sku.syncHealth?.fullySynced),
    [filtered]
  );

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/catalog/push-requests/${id}/approve`, { method: "POST" });
      const data = await res.json() as ApproveResponse;
      if (!res.ok) throw new Error(data.error);
      setPendingPushes((prev) => prev.filter((p) => p.id !== id));
      setPendingCount((c) => Math.max(0, c - 1));

      const summary = data.summary;
      if (!summary) {
        addToast({ type: "success", title: "Request approved" });
      } else if (summary.success === summary.selected) {
        addToast({
          type: "success",
          title: "Approved. All selected systems completed.",
          message: `${summary.success}/${summary.selected} systems succeeded.`,
        });
      } else if (summary.success > 0) {
        addToast({
          type: "warning",
          title: "Approved with partial execution",
          message: `${summary.success}/${summary.selected} succeeded, ${summary.notImplemented} not implemented, ${summary.skipped} skipped, ${summary.failed} failed.`,
        });
      } else {
        addToast({
          type: "warning",
          title: "Approved, but no selected systems completed",
          message: `${summary.notImplemented} not implemented, ${summary.skipped} skipped, ${summary.failed} failed.`,
        });
      }
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

  function beginSkuEdit(sku: Sku) {
    setEditingSkuId(sku.id);
    setSkuEditDraft({
      id: sku.id,
      category: sku.category,
      brand: sku.brand,
      model: sku.model,
      description: sku.description ?? "",
      vendorName: sku.vendorName ?? "",
      vendorPartNumber: sku.vendorPartNumber ?? "",
      unitSpec: sku.unitSpec != null ? String(sku.unitSpec) : "",
      unitLabel: sku.unitLabel ?? "",
      unitCost: sku.unitCost != null ? String(sku.unitCost) : "",
      sellPrice: sku.sellPrice != null ? String(sku.sellPrice) : "",
      zohoItemId: sku.zohoItemId ?? "",
      hubspotProductId: sku.hubspotProductId ?? "",
      zuperItemId: sku.zuperItemId ?? "",
      isActive: sku.isActive,
    });
  }

  function cancelSkuEdit() {
    setEditingSkuId(null);
    setSkuEditDraft(null);
    setSavingSkuEdit(false);
  }

  async function saveSkuEdit() {
    if (!skuEditDraft) return;
    setSavingSkuEdit(true);
    try {
      const res = await fetch("/api/inventory/skus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: skuEditDraft.id,
          category: skuEditDraft.category,
          brand: skuEditDraft.brand,
          model: skuEditDraft.model,
          description: skuEditDraft.description,
          vendorName: skuEditDraft.vendorName,
          vendorPartNumber: skuEditDraft.vendorPartNumber,
          unitSpec: skuEditDraft.unitSpec || null,
          unitLabel: skuEditDraft.unitLabel || null,
          unitCost: skuEditDraft.unitCost || null,
          sellPrice: skuEditDraft.sellPrice || null,
          zohoItemId: skuEditDraft.zohoItemId || null,
          hubspotProductId: skuEditDraft.hubspotProductId || null,
          zuperItemId: skuEditDraft.zuperItemId || null,
          isActive: skuEditDraft.isActive,
        }),
      });
      const data = await res.json() as { error?: string; sku?: Sku };
      if (!res.ok || !data.sku) throw new Error(data.error || "Save failed");
      setSkus((prev) => prev.map((row) => (row.id === data.sku!.id ? data.sku! : row)));
      addToast({ type: "success", title: "SKU updated" });
      cancelSkuEdit();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to update SKU" });
    } finally {
      setSavingSkuEdit(false);
    }
  }

  function beginPushEdit(push: PushRequest) {
    setEditingPushId(push.id);
    setPushEditDraft({
      id: push.id,
      brand: push.brand,
      model: push.model,
      description: push.description,
      category: push.category,
      unitSpec: push.unitSpec ?? "",
      unitLabel: push.unitLabel ?? "",
      systems: [...push.systems],
    });
  }

  function cancelPushEdit() {
    setEditingPushId(null);
    setPushEditDraft(null);
    setSavingPushEdit(false);
  }

  function togglePushSystem(system: string) {
    setPushEditDraft((prev) => {
      if (!prev) return prev;
      const has = prev.systems.includes(system);
      const nextSystems = has
        ? prev.systems.filter((s) => s !== system)
        : [...prev.systems, system];
      return { ...prev, systems: nextSystems };
    });
  }

  async function savePushEdit() {
    if (!pushEditDraft) return;
    if (pushEditDraft.systems.length === 0) {
      addToast({ type: "error", title: "Select at least one target system" });
      return;
    }
    setSavingPushEdit(true);
    try {
      const res = await fetch(`/api/catalog/push-requests/${pushEditDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: pushEditDraft.brand,
          model: pushEditDraft.model,
          description: pushEditDraft.description,
          category: pushEditDraft.category,
          unitSpec: pushEditDraft.unitSpec || null,
          unitLabel: pushEditDraft.unitLabel || null,
          systems: pushEditDraft.systems,
        }),
      });
      const data = await res.json() as { error?: string; push?: PushRequest };
      if (!res.ok || !data.push) throw new Error(data.error || "Save failed");
      setPendingPushes((prev) => prev.map((row) => (row.id === data.push!.id ? data.push! : row)));
      addToast({ type: "success", title: "Pending request updated" });
      cancelPushEdit();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to update request" });
    } finally {
      setSavingPushEdit(false);
    }
  }

  return (
    <DashboardShell title="Equipment Catalog" accentColor="cyan">
      {/* Tabs + Submit button */}
      <div className="flex items-center gap-1 mb-6 border-b border-t-border">
        {(["skus", "sync", "pending"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-cyan-500 text-cyan-500"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "skus" && "Equipment SKUs"}
            {t === "sync" && "Sync Health"}
            {t === "pending" && (
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
          <Link
            href="/dashboards/catalog/new"
            className="px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors flex items-center gap-1.5"
          >
            + Submit New Product
          </Link>
        </div>
      </div>

      {(tab === "skus" || tab === "sync") && (
        <div className="flex flex-wrap gap-3 mb-4">
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
            placeholder="Search brand, model, description, or vendor part…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50 flex-1 min-w-48"
          />
          <span className="ml-auto text-xs text-muted self-center">
            {filtered.length} of {skus.length} SKU{skus.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* SKUs Tab */}
      {tab === "skus" && (
        <div className="space-y-4">
          {skuLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading SKUs…</p>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-x-auto">
              <table className="min-w-[1420px] w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-surface-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-left">Brand</th>
                    <th className="px-4 py-2 text-left">Model / Description</th>
                    <th className="px-4 py-2 text-left">Vendor Part</th>
                    <th className="px-4 py-2 text-left">Unit</th>
                    <th className="px-4 py-2 text-right">Unit Cost</th>
                    <th className="px-4 py-2 text-right">Sell Price</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                    <th className="px-4 py-2 text-left">Sync Status</th>
                    <th className="px-4 py-2 text-right">Stock</th>
                    {isAdmin && <th className="px-4 py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 11 : 10} className="px-4 py-8 text-center text-sm text-muted">No SKUs found.</td>
                    </tr>
                  ) : filtered.map((sku) => (
                    <tr key={sku.id} className="border-b border-t-border last:border-b-0 hover:bg-surface-2 transition-colors align-top">
                      <td className="px-4 py-3 text-xs text-muted font-medium">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <select
                            value={skuEditDraft.category}
                            onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, category: e.target.value } : prev)}
                            className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : sku.category}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <input
                            value={skuEditDraft.brand}
                            onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, brand: e.target.value } : prev)}
                            className="w-full rounded border border-t-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        ) : sku.brand}
                      </td>
                      <td className="px-4 py-3 min-w-[280px]">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <div className="space-y-1.5">
                            <input
                              value={skuEditDraft.model}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, model: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Model"
                            />
                            <input
                              value={skuEditDraft.description}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Description"
                            />
                            <input
                              value={skuEditDraft.vendorName}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, vendorName: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Vendor Name"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-medium text-foreground">{sku.model}</div>
                            {sku.description && (
                              <div className="text-xs text-muted mt-0.5">{sku.description}</div>
                            )}
                            {sku.vendorName && (
                              <div className="text-xs text-muted/70 mt-0.5">Vendor: {sku.vendorName}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <input
                            value={skuEditDraft.vendorPartNumber}
                            onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, vendorPartNumber: e.target.value } : prev)}
                            className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        ) : (sku.vendorPartNumber || "—")}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <div className="flex gap-1.5">
                            <input
                              value={skuEditDraft.unitSpec}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitSpec: e.target.value } : prev)}
                              className="w-20 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Spec"
                            />
                            <input
                              value={skuEditDraft.unitLabel}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitLabel: e.target.value } : prev)}
                              className="w-16 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Unit"
                            />
                          </div>
                        ) : (
                          sku.unitSpec != null ? `${sku.unitSpec}${sku.unitLabel ? ` ${sku.unitLabel}` : ""}` : "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <input
                            value={skuEditDraft.unitCost}
                            onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitCost: e.target.value } : prev)}
                            className="w-24 rounded border border-t-border bg-surface px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="0.00"
                          />
                        ) : money(sku.unitCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <input
                            value={skuEditDraft.sellPrice}
                            onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, sellPrice: e.target.value } : prev)}
                            className="w-24 rounded border border-t-border bg-surface px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="0.00"
                          />
                        ) : money(sku.sellPrice)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">{marginPercent(
                        editingSkuId === sku.id && skuEditDraft ? parseNumberOrNull(skuEditDraft.unitCost) : sku.unitCost,
                        editingSkuId === sku.id && skuEditDraft ? parseNumberOrNull(skuEditDraft.sellPrice) : sku.sellPrice
                      )}</td>
                      <td className="px-4 py-3 text-xs">
                        {editingSkuId === sku.id && skuEditDraft ? (
                          <div className="space-y-1">
                            <input
                              value={skuEditDraft.zohoItemId}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, zohoItemId: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Zoho Item ID"
                            />
                            <input
                              value={skuEditDraft.hubspotProductId}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, hubspotProductId: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="HubSpot Product ID"
                            />
                            <input
                              value={skuEditDraft.zuperItemId}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, zuperItemId: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Zuper Item ID"
                            />
                            <label className="inline-flex items-center gap-1 text-[11px] text-muted">
                              <input
                                type="checkbox"
                                checked={skuEditDraft.isActive}
                                onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, isActive: e.target.checked } : prev)}
                              />
                              Active
                            </label>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <SyncDot label="Zoho" ok={sku.syncHealth?.zoho ?? Boolean(sku.zohoItemId)} />
                            <SyncDot label="HS" ok={sku.syncHealth?.hubspot ?? Boolean(sku.hubspotProductId)} />
                            <SyncDot label="Zu" ok={sku.syncHealth?.zuper ?? Boolean(sku.zuperItemId)} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">
                        {sku.stockLevels.reduce((sum, l) => sum + l.quantityOnHand, 0)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right text-xs">
                          {editingSkuId === sku.id ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={saveSkuEdit}
                                disabled={savingSkuEdit}
                                className="text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                              >
                                {savingSkuEdit ? "Saving…" : "Save"}
                              </button>
                              <button
                                onClick={cancelSkuEdit}
                                disabled={savingSkuEdit}
                                className="text-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-3">
                              <button
                                onClick={() => beginSkuEdit(sku)}
                                className="text-cyan-400 hover:text-cyan-300"
                              >
                                Quick Edit
                              </button>
                              <Link
                                href={`/dashboards/catalog/edit/${sku.id}`}
                                className="text-cyan-400 hover:text-cyan-300"
                              >
                                Full Edit
                              </Link>
                              <button
                                onClick={() => handleDeleteClick({
                                  id: sku.id,
                                  category: sku.category,
                                  brand: sku.brand,
                                  model: sku.model,
                                })}
                                className="text-red-400 hover:text-red-300"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sync Tab */}
      {tab === "sync" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard label="Total" value={skuSummary.total} />
            <MetricCard label="Fully Synced" value={skuSummary.fullySynced} />
            <MetricCard label="Missing Zoho" value={skuSummary.missingZoho} />
            <MetricCard label="Missing HubSpot" value={skuSummary.missingHubspot} />
            <MetricCard label="Missing Zuper" value={skuSummary.missingZuper} />
            <MetricCard label="With Pricing" value={skuSummary.withPricing} />
          </div>

          {/* Per-Category Sync Breakdown */}
          {categoryStatsLoading ? (
            <p className="text-sm text-muted animate-pulse py-4 text-center">Loading per-category stats…</p>
          ) : categoryStats.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">By Category</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {categoryStats.map((cat) => {
                  const syncPct = cat.total > 0 ? Math.round((cat.fullySynced / cat.total) * 100) : 0;
                  return (
                    <div
                      key={cat.category}
                      className="rounded-xl border border-t-border bg-surface shadow-card p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">
                          {cat.category.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-muted">{cat.total} SKUs</span>
                      </div>
                      <div className="w-full bg-surface-2 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${syncPct === 100 ? "bg-green-500" : syncPct >= 50 ? "bg-yellow-500" : "bg-red-400"}`}
                          style={{ width: `${syncPct}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted">
                        <div className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${cat.hasZoho === cat.total ? "bg-green-500" : "bg-red-400"}`} />
                          Zoho {cat.hasZoho}/{cat.total}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${cat.hasHubspot === cat.total ? "bg-green-500" : "bg-red-400"}`} />
                          HS {cat.hasHubspot}/{cat.total}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${cat.hasZuper === cat.total ? "bg-green-500" : "bg-red-400"}`} />
                          Zu {cat.hasZuper}/{cat.total}
                        </div>
                      </div>
                      <div className="text-xs text-muted">
                        {syncPct}% synced · {cat.withPricing} with pricing
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {skuLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading sync health…</p>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-surface-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-left">Brand</th>
                    <th className="px-4 py-2 text-left">Model</th>
                    <th className="px-4 py-2 text-left">Missing Integrations</th>
                    <th className="px-4 py-2 text-left">IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {unsynced.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                        All filtered SKUs are fully synced.
                      </td>
                    </tr>
                  ) : unsynced.map((sku) => {
                    const missing: string[] = [];
                    if (!sku.syncHealth?.zoho && !sku.zohoItemId) missing.push("Zoho");
                    if (!sku.syncHealth?.hubspot && !sku.hubspotProductId) missing.push("HubSpot");
                    if (!sku.syncHealth?.zuper && !sku.zuperItemId) missing.push("Zuper");
                    return (
                      <tr key={sku.id} className="border-b border-t-border last:border-b-0 hover:bg-surface-2 transition-colors align-top">
                        <td className="px-4 py-3 text-xs text-muted">{sku.category}</td>
                        <td className="px-4 py-3 text-foreground font-medium">{sku.brand}</td>
                        <td className="px-4 py-3 text-foreground">{sku.model}</td>
                        <td className="px-4 py-3 text-xs">
                          {missing.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {missing.map((m) => (
                                <span key={m} className="inline-flex items-center rounded-md bg-red-500/15 px-2 py-0.5 text-red-400 ring-1 ring-red-500/30">
                                  {m}
                                </span>
                              ))}
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">
                          <div>Zoho: {sku.zohoItemId || "—"}</div>
                          <div>HubSpot: {sku.hubspotProductId || "—"}</div>
                          <div>Zuper: {sku.zuperItemId || "—"}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                    {editingPushId === p.id && pushEditDraft ? (
                      <div className="space-y-1.5">
                        <input
                          value={pushEditDraft.brand}
                          onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, brand: e.target.value } : prev)}
                          className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          placeholder="Brand"
                        />
                        <input
                          value={pushEditDraft.model}
                          onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, model: e.target.value } : prev)}
                          className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          placeholder="Model"
                        />
                        <input
                          value={pushEditDraft.description}
                          onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                          className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          placeholder="Description"
                        />
                        <div className="flex gap-1.5">
                          <select
                            value={pushEditDraft.category}
                            onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, category: e.target.value } : prev)}
                            className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            value={pushEditDraft.unitSpec}
                            onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, unitSpec: e.target.value } : prev)}
                            className="w-20 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="Spec"
                          />
                          <input
                            value={pushEditDraft.unitLabel}
                            onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, unitLabel: e.target.value } : prev)}
                            className="w-16 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="Unit"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium text-foreground truncate">{p.brand} — {p.model}</div>
                        <div className="text-xs text-muted truncate">{p.description}</div>
                        <div className="text-xs text-muted/60 mt-0.5">{p.category}</div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {editingPushId === p.id && pushEditDraft ? (
                      SYSTEM_OPTIONS.map((system) => {
                        const checked = pushEditDraft.systems.includes(system);
                        return (
                          <label
                            key={system}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ${checked ? "bg-cyan-500/15 text-cyan-400 ring-cyan-500/30" : "bg-surface text-muted ring-[color:var(--border)]"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePushSystem(system)}
                            />
                            {system}
                          </label>
                        );
                      })
                    ) : (
                      p.systems.map((s) => (
                        <span key={s} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/30">
                          {s}
                        </span>
                      ))
                    )}
                  </div>
                  <span className="text-xs text-muted truncate">{p.requestedBy}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      {editingPushId === p.id ? (
                        <>
                          <button
                            onClick={savePushEdit}
                            disabled={savingPushEdit}
                            className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline font-medium transition-colors disabled:opacity-50"
                          >
                            {savingPushEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelPushEdit}
                            disabled={savingPushEdit}
                            className="text-xs text-muted hover:text-foreground hover:underline transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => beginPushEdit(p)}
                            className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                          >
                            Edit
                          </button>
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
                        </>
                      )}
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
      {deleteTarget && (
        <DeleteSkuModal
          sku={deleteTarget.sku}
          warning={deleteTarget.warning}
          syncedSystems={deleteTarget.syncedSystems}
          pendingCount={deleteTarget.pendingCount}
          onConfirm={handleForceDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </DashboardShell>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-t-border bg-surface shadow-card px-4 py-3">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}
