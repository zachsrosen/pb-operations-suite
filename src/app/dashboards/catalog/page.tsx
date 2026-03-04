// src/app/dashboards/catalog/page.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import SyncModal from "@/components/catalog/SyncModal";
import DedupPanel from "@/components/catalog/DedupPanel";

type Tab = "skus" | "sync" | "pending" | "dedup";

interface SkuSyncHealth {
  internal: boolean;
  zoho: boolean;
  hubspot: boolean;
  zuper: boolean;
  quickbooks: boolean;
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
  quickbooksItemId: string | null;
  syncHealth: SkuSyncHealth;
  stockLevels: { location: string; quantityOnHand: number }[];
}

interface SkuSummary {
  total: number;
  fullySynced: number;
  missingZoho: number;
  missingHubspot: number;
  missingZuper: number;
  missingQuickbooks: number;
  duplicateGroups: number;
  duplicateRows: number;
  withPricing: number;
}

interface CategorySyncStat {
  category: string;
  total: number;
  fullySynced: number;
  hasZoho: number;
  hasHubspot: number;
  hasZuper: number;
  hasQuickbooks: number;
  withPricing: number;
}

interface DuplicateGroup {
  key: string;
  category: string;
  canonicalBrand: string;
  canonicalModel: string;
  count: number;
  entries: Array<{
    id: string;
    brand: string;
    model: string;
    sku: string | null;
    vendorPartNumber: string | null;
    quickbooksItemId: string | null;
  }>;
}

interface PushRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  brand: string;
  model: string;
  description: string;
  category: string;
  unitSpec: string | null;
  unitLabel: string | null;
  sku: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  hardToProcure: boolean;
  length: number | null;
  width: number | null;
  weight: number | null;
  systems: string[];
  quickbooksItemId: string | null;
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
  push?: PushRequest;
  summary?: ApproveSummary;
  outcomes?: Record<string, { status: ApproveOutcomeStatus; message?: string; externalId?: string | null }>;
  retryable?: boolean;
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
  quickbooksItemId: string;
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
  sku: string;
  vendorName: string;
  vendorPartNumber: string;
  unitCost: string;
  sellPrice: string;
  hardToProcure: boolean;
  length: string;
  width: string;
  weight: string;
  systems: string[];
  quickbooksItemId: string;
}

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
// QuickBooks deactivated — re-add "QUICKBOOKS" to reactivate
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

function formatSystemLabel(system: string): string {
  if (system === "INTERNAL") return "Internal";
  if (system === "HUBSPOT") return "HubSpot";
  if (system === "ZUPER") return "Zuper";
  if (system === "ZOHO") return "Zoho";
  if (system === "QUICKBOOKS") return "QuickBooks";
  return system;
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
    missingQuickbooks: 0,
    duplicateGroups: 0,
    duplicateRows: 0,
    withPricing: 0,
  });
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [linkingQuickBooks, setLinkingQuickBooks] = useState(false);
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

  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncSkuId, setSyncSkuId] = useState<string | null>(null);
  const [syncSkuName, setSyncSkuName] = useState("");
  const [cleanupSkuId, setCleanupSkuId] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupAction, setCleanupAction] = useState<"unlink" | "deactivate">("unlink");
  const [cleanupSources, setCleanupSources] = useState<string[]>([]);
  const [cleanupExternal, setCleanupExternal] = useState(false);
  const [cleanupConfirmInput, setCleanupConfirmInput] = useState("");

  const [categoryStats, setCategoryStats] = useState<CategorySyncStat[]>([]);
  const [categoryStatsLoading, setCategoryStatsLoading] = useState(false);

  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);

  // Fetch SKUs
  const fetchSkus = useCallback(() => {
    setSkuLoading(true);
    fetch("/api/inventory/skus?active=false")
      .then((r) => r.json())
      .then((d: { skus?: Sku[]; summary?: SkuSummary; duplicates?: DuplicateGroup[] }) => {
        setSkus(d.skus ?? []);
        setDuplicateGroups(d.duplicates ?? []);
        setSkuSummary(d.summary ?? {
          total: 0,
          fullySynced: 0,
          missingZoho: 0,
          missingHubspot: 0,
          missingZuper: 0,
          missingQuickbooks: 0,
          duplicateGroups: 0,
          duplicateRows: 0,
          withPricing: 0,
        });
      })
      .catch(() => addToast({ type: "error", title: "Failed to load SKUs" }))
      .finally(() => setSkuLoading(false));
  }, [addToast]);

  useEffect(() => { fetchSkus(); }, [fetchSkus]);

  // Check cleanup feature flag
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/products/cleanup/confirm", { method: "GET", cache: "no-store" })
      .then((r) => setCleanupEnabled(r.ok))
      .catch(() => setCleanupEnabled(false));
  }, [isAdmin]);

  // Check sync feature flag (reuse any linked SKU's sync preview endpoint — a 404 means disabled)
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/inventory/skus/sync-enabled", { cache: "no-store" })
      .then((r) => setSyncEnabled(r.ok))
      .catch(() => setSyncEnabled(false));
  }, [isAdmin]);

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
      const isApproved = data.push?.status === "APPROVED";
      if (isApproved) {
        setPendingPushes((prev) => prev.filter((p) => p.id !== id));
        setPendingCount((c) => Math.max(0, c - 1));
      } else if (data.push) {
        setPendingPushes((prev) => prev.map((p) => (p.id === data.push!.id ? data.push! : p)));
      }

      const summary = data.summary;
      if (!summary) {
        addToast({ type: isApproved ? "success" : "warning", title: isApproved ? "Request approved" : "Push attempt incomplete" });
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
          title: isApproved ? "Approved, but no selected systems completed" : "Still pending for retry",
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
      quickbooksItemId: sku.quickbooksItemId ?? "",
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
          quickbooksItemId: skuEditDraft.quickbooksItemId || null,
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
      sku: push.sku ?? "",
      vendorName: push.vendorName ?? "",
      vendorPartNumber: push.vendorPartNumber ?? "",
      unitCost: push.unitCost != null ? String(push.unitCost) : "",
      sellPrice: push.sellPrice != null ? String(push.sellPrice) : "",
      hardToProcure: push.hardToProcure ?? false,
      length: push.length != null ? String(push.length) : "",
      width: push.width != null ? String(push.width) : "",
      weight: push.weight != null ? String(push.weight) : "",
      systems: [...push.systems],
      quickbooksItemId: push.quickbooksItemId ?? "",
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
          sku: pushEditDraft.sku || null,
          vendorName: pushEditDraft.vendorName || null,
          vendorPartNumber: pushEditDraft.vendorPartNumber || null,
          unitCost: pushEditDraft.unitCost ? parseFloat(pushEditDraft.unitCost) : null,
          sellPrice: pushEditDraft.sellPrice ? parseFloat(pushEditDraft.sellPrice) : null,
          hardToProcure: pushEditDraft.hardToProcure,
          length: pushEditDraft.length ? parseFloat(pushEditDraft.length) : null,
          width: pushEditDraft.width ? parseFloat(pushEditDraft.width) : null,
          weight: pushEditDraft.weight ? parseFloat(pushEditDraft.weight) : null,
          systems: pushEditDraft.systems,
          quickbooksItemId:
            pushEditDraft.systems.includes("QUICKBOOKS")
              ? pushEditDraft.quickbooksItemId || null
              : null,
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

  // ── Single-item cleanup ──
  const cleanupSku = useMemo(
    () => (cleanupSkuId ? skus.find((s) => s.id === cleanupSkuId) ?? null : null),
    [cleanupSkuId, skus]
  );

  const CLEANUP_CONFIRM_TEXT = "CLEANUP";
  const CLEANUP_LINKABLE_SOURCES = ["hubspot", "zuper", "zoho"] as const;

  function openCleanupModal(skuId: string) {
    setCleanupSkuId(skuId);
    setCleanupAction("unlink");
    setCleanupSources([]);
    setCleanupExternal(false);
    setCleanupConfirmInput("");
  }

  function closeCleanupModal() {
    if (cleanupRunning) return;
    setCleanupSkuId(null);
    setCleanupConfirmInput("");
  }

  async function runSingleCleanup() {
    if (cleanupRunning || !cleanupSkuId) return;
    if (cleanupConfirmInput.trim().toUpperCase() !== CLEANUP_CONFIRM_TEXT) {
      addToast({ type: "error", title: `Type ${CLEANUP_CONFIRM_TEXT} to confirm.` });
      return;
    }

    const actions = {
      internal: cleanupAction === "deactivate" ? "deactivate" : "none",
      links: cleanupAction === "unlink" ? "unlink_selected" : "none",
      external: cleanupExternal ? "delete_selected" : "none",
      sources: cleanupExternal
        ? cleanupSources
        : cleanupAction === "unlink"
          ? [...CLEANUP_LINKABLE_SOURCES]
          : [],
      deleteCachedProducts: cleanupExternal,
    };

    setCleanupRunning(true);
    try {
      // Step 1: Get confirmation token
      const confirmRes = await fetch("/api/products/cleanup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalSkuIds: [cleanupSkuId], actions }),
      });
      const confirmData = (await confirmRes.json().catch(() => null)) as {
        token?: string;
        issuedAt?: number;
        error?: string;
      } | null;
      if (!confirmRes.ok || !confirmData?.token || typeof confirmData.issuedAt !== "number") {
        throw new Error(confirmData?.error || "Failed to create confirmation token.");
      }

      // Step 2: Execute cleanup
      const cleanupRes = await fetch("/api/products/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalSkuIds: [cleanupSkuId],
          actions,
          dryRun: false,
          confirmation: { token: confirmData.token, issuedAt: confirmData.issuedAt },
        }),
      });
      const result = (await cleanupRes.json().catch(() => null)) as {
        summary?: { total: number; succeeded: number; partial: number; failed: number };
        results?: Array<{ internalSkuId: string; status: string; message: string }>;
        error?: string;
      } | null;
      if (!cleanupRes.ok || !result?.summary) {
        throw new Error(result?.error || "Cleanup request failed.");
      }

      const firstResult = result.results?.[0];
      if (firstResult?.status === "failed") {
        addToast({ type: "error", title: "Cleanup failed", message: firstResult.message });
      } else if (firstResult?.status === "partial") {
        addToast({ type: "warning", title: "Cleanup partial", message: firstResult.message });
      } else {
        addToast({ type: "success", title: "Cleanup completed" });
      }

      fetchSkus();
      // Reset cleanupRunning before closing so closeCleanupModal() doesn't early-return
      setCleanupRunning(false);
      closeCleanupModal();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Cleanup failed" });
    } finally {
      setCleanupRunning(false);
    }
  }

  async function handleAutoLinkQuickBooks() {
    setLinkingQuickBooks(true);
    try {
      const res = await fetch("/api/inventory/skus/link-quickbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, onlyMissing: true }),
      });
      const data = await res.json() as {
        error?: string;
        evaluated?: number;
        matched?: number;
        ambiguous?: number;
        noMatch?: number;
      };
      if (!res.ok) throw new Error(data.error || "Failed to auto-link QuickBooks");
      addToast({
        type: "success",
        title: "QuickBooks linking complete",
        message: `Matched ${data.matched ?? 0} of ${data.evaluated ?? 0} checked (${data.ambiguous ?? 0} ambiguous, ${data.noMatch ?? 0} no match).`,
      });
      fetchSkus();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to auto-link QuickBooks" });
    } finally {
      setLinkingQuickBooks(false);
    }
  }

  return (
    <DashboardShell title="Equipment Catalog" accentColor="cyan">
      {/* Tabs + Submit button */}
      <div className="flex items-center gap-1 mb-6 border-b border-t-border">
        {(["skus", "sync", "pending", ...(syncEnabled ? ["dedup" as Tab] : [])] as Tab[]).map((t) => (
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
            {t === "dedup" && "Zoho Dedup"}
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
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-t-border bg-surface shadow-card px-4 py-8 text-center text-sm text-muted">
                  No SKUs found.
                </div>
              ) : filtered.map((sku) => {
                const editing = editingSkuId === sku.id && Boolean(skuEditDraft);
                const totalStock = sku.stockLevels.reduce((sum, l) => sum + l.quantityOnHand, 0);
                const effectiveUnitCost = editing && skuEditDraft ? parseNumberOrNull(skuEditDraft.unitCost) : sku.unitCost;
                const effectiveSellPrice = editing && skuEditDraft ? parseNumberOrNull(skuEditDraft.sellPrice) : sku.sellPrice;

                return (
                  <article key={sku.id} className="rounded-xl border border-t-border bg-surface shadow-card p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {editing && skuEditDraft ? (
                            <select
                              value={skuEditDraft.category}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, category: e.target.value } : prev)}
                              className="rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            >
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                              {sku.category}
                            </span>
                          )}
                          <span className={`text-xs ${sku.isActive ? "text-green-400" : "text-red-300"}`}>
                            {sku.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>

                        {editing && skuEditDraft ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input
                              value={skuEditDraft.brand}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, brand: e.target.value } : prev)}
                              className="rounded border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Brand"
                            />
                            <input
                              value={skuEditDraft.model}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, model: e.target.value } : prev)}
                              className="rounded border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Model"
                            />
                            <input
                              value={skuEditDraft.description}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                              className="md:col-span-2 rounded border border-t-border bg-surface px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Description"
                            />
                            <input
                              value={skuEditDraft.vendorName}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, vendorName: e.target.value } : prev)}
                              className="rounded border border-t-border bg-surface px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Vendor Name"
                            />
                            <input
                              value={skuEditDraft.vendorPartNumber}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, vendorPartNumber: e.target.value } : prev)}
                              className="rounded border border-t-border bg-surface px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Vendor Part Number"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="text-base font-semibold text-foreground break-words">
                              {sku.brand} - {sku.model}
                            </div>
                            {sku.description && (
                              <div className="text-sm text-muted break-words">{sku.description}</div>
                            )}
                            {sku.vendorName && (
                              <div className="text-xs text-muted/70">Vendor: {sku.vendorName}</div>
                            )}
                          </>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="flex items-center gap-3 text-xs">
                          {editing ? (
                            <>
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
                            </>
                          ) : (
                            <>
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
                              {syncEnabled && (sku.zohoItemId || sku.hubspotProductId || sku.zuperItemId) && (
                                <button
                                  onClick={() => {
                                    setSyncSkuId(sku.id);
                                    setSyncSkuName(`${sku.brand} ${sku.model}`);
                                  }}
                                  className="text-orange-400 hover:text-orange-300"
                                >
                                  Sync
                                </button>
                              )}
                              {cleanupEnabled && (
                                <button
                                  onClick={() => openCleanupModal(sku.id)}
                                  className="text-amber-400 hover:text-amber-300"
                                >
                                  Cleanup
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1.5">
                        <div className="text-muted uppercase tracking-wide">Unit</div>
                        {editing && skuEditDraft ? (
                          <div className="flex gap-1.5">
                            <input
                              value={skuEditDraft.unitSpec}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitSpec: e.target.value } : prev)}
                              className="w-24 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Spec"
                            />
                            <input
                              value={skuEditDraft.unitLabel}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitLabel: e.target.value } : prev)}
                              className="w-20 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Unit"
                            />
                          </div>
                        ) : (
                          <div className="text-foreground">
                            {sku.unitSpec != null ? `${sku.unitSpec}${sku.unitLabel ? ` ${sku.unitLabel}` : ""}` : "—"}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1.5">
                        <div className="text-muted uppercase tracking-wide">Pricing</div>
                        {editing && skuEditDraft ? (
                          <div className="space-y-1.5">
                            <input
                              value={skuEditDraft.unitCost}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, unitCost: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Unit Cost"
                            />
                            <input
                              value={skuEditDraft.sellPrice}
                              onChange={(e) => setSkuEditDraft((prev) => prev ? { ...prev, sellPrice: e.target.value } : prev)}
                              className="w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Sell Price"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1 text-foreground">
                            <div>Cost: {money(sku.unitCost)}</div>
                            <div>Sell: {money(sku.sellPrice)}</div>
                            <div className="text-muted">Margin: {marginPercent(sku.unitCost, sku.sellPrice)}</div>
                          </div>
                        )}
                        {editing && (
                          <div className="text-muted">Margin: {marginPercent(effectiveUnitCost, effectiveSellPrice)}</div>
                        )}
                      </div>

                      <div className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1.5">
                        <div className="text-muted uppercase tracking-wide">Inventory</div>
                        <div className="text-foreground">Stock: {totalStock}</div>
                        <div className="text-muted">Vendor Part: {editing && skuEditDraft ? skuEditDraft.vendorPartNumber || "—" : sku.vendorPartNumber || "—"}</div>
                      </div>

                      <div className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1.5">
                        <div className="text-muted uppercase tracking-wide">Sync</div>
                        {editing && skuEditDraft ? (
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
                            {/* QuickBooks deactivated — input hidden */}
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
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                              <SyncDot label="Zoho" ok={sku.syncHealth?.zoho ?? Boolean(sku.zohoItemId)} />
                              <SyncDot label="HS" ok={sku.syncHealth?.hubspot ?? Boolean(sku.hubspotProductId)} />
                              <SyncDot label="Zu" ok={sku.syncHealth?.zuper ?? Boolean(sku.zuperItemId)} />
                            </div>
                            <div className="text-[11px] text-muted">
                              Zoho: {sku.zohoItemId || "—"} · HS: {sku.hubspotProductId || "—"}
                            </div>
                            <div className="text-[11px] text-muted">
                              Zu: {sku.zuperItemId || "—"}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sync Tab */}
      {tab === "sync" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <MetricCard label="Total" value={skuSummary.total} />
            <MetricCard label="Fully Synced" value={skuSummary.fullySynced} />
            <MetricCard label="Missing Zoho" value={skuSummary.missingZoho} />
            <MetricCard label="Missing HubSpot" value={skuSummary.missingHubspot} />
            <MetricCard label="Missing Zuper" value={skuSummary.missingZuper} />
            <MetricCard label="Duplicate Groups" value={skuSummary.duplicateGroups} />
            <MetricCard label="Duplicate Rows" value={skuSummary.duplicateRows} />
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
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
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
                    // QuickBooks deactivated
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

          {duplicateGroups.length > 0 && (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
              <div className="border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                Duplicate Review ({duplicateGroups.length} groups)
              </div>
              <div className="max-h-[360px] overflow-auto">
                {duplicateGroups.slice(0, 100).map((group) => (
                  <div key={group.key} className="border-b border-t-border last:border-b-0 px-4 py-3">
                    <div className="text-xs text-muted mb-2">
                      {group.category} · {group.count} rows · canonical {group.canonicalBrand} / {group.canonicalModel}
                    </div>
                    <div className="space-y-1">
                      {group.entries.map((entry) => (
                        <div key={entry.id} className="text-xs text-foreground">
                          {entry.brand} — {entry.model}
                          {entry.sku ? ` · SKU ${entry.sku}` : ""}
                          {entry.vendorPartNumber ? ` · VP ${entry.vendorPartNumber}` : ""}
                          {/* QuickBooks deactivated */}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
              {pendingPushes.map((p) => {
                const isEditing = editingPushId === p.id && pushEditDraft;
                const inputCls = "w-full rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500";
                const labelCls = "text-[10px] uppercase tracking-wide text-muted mb-0.5";
                return (
                <div key={p.id} className="border-b border-t-border last:border-b-0">
                  {/* Summary row */}
                  <div className={`grid ${isAdmin ? "grid-cols-[1fr_1fr_140px_100px_120px]" : "grid-cols-[1fr_1fr_140px_100px]"} gap-x-3 items-center px-4 py-3 text-sm hover:bg-surface-2 transition-colors`}>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{p.brand} — {p.model}</div>
                      <div className="text-xs text-muted truncate">{p.description}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted/70">
                        <span>{p.category}</span>
                        {p.sku && <span>SKU: {p.sku}</span>}
                        {p.vendorName && <span>Vendor: {p.vendorName}</span>}
                        {(p.unitCost != null || p.sellPrice != null) && (
                          <span>
                            {p.unitCost != null ? `Cost: ${money(p.unitCost)}` : ""}
                            {p.unitCost != null && p.sellPrice != null ? " / " : ""}
                            {p.sellPrice != null ? `Sell: ${money(p.sellPrice)}` : ""}
                          </span>
                        )}
                        {p.hardToProcure && <span className="text-amber-400">Hard to Procure</span>}
                      </div>
                      {/* QuickBooks deactivated */}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.systems.map((s) => (
                        <span key={s} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/30">
                          {formatSystemLabel(s)}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs text-muted truncate">{p.requestedBy}</span>
                    <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleDateString()}</span>
                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={savePushEdit} disabled={savingPushEdit} className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline font-medium transition-colors disabled:opacity-50">
                              {savingPushEdit ? "Saving…" : "Save"}
                            </button>
                            <button onClick={cancelPushEdit} disabled={savingPushEdit} className="text-xs text-muted hover:text-foreground hover:underline transition-colors">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => beginPushEdit(p)} className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-colors">Edit</button>
                            <button onClick={() => handleApprove(p.id)} className="text-xs text-green-400 hover:text-green-300 hover:underline font-medium transition-colors">Approve</button>
                            <button onClick={() => handleReject(p.id)} className="text-xs text-red-400 hover:text-red-300 hover:underline transition-colors">Reject</button>
                          </>
                        )}
                      </div>
                    )}
                    {!isAdmin && <span className="text-xs text-muted italic">Awaiting admin</span>}
                  </div>

                  {/* Expandable edit panel */}
                  {isEditing && pushEditDraft && (
                    <div className="border-t border-t-border bg-surface-2 px-4 py-4 space-y-3">
                      {/* Identity */}
                      <div>
                        <div className={labelCls}>Identity</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input value={pushEditDraft.brand} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, brand: e.target.value } : prev)} className={inputCls} placeholder="Brand *" />
                          <input value={pushEditDraft.model} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, model: e.target.value } : prev)} className={inputCls} placeholder="Model *" />
                          <input value={pushEditDraft.sku} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, sku: e.target.value } : prev)} className={inputCls} placeholder="SKU" />
                          <select value={pushEditDraft.category} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, category: e.target.value } : prev)} className={inputCls}>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <div className={labelCls}>Description</div>
                        <textarea
                          value={pushEditDraft.description}
                          onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                          className={`${inputCls} resize-none`}
                          rows={2}
                          placeholder="Description *"
                        />
                      </div>

                      {/* Vendor */}
                      <div>
                        <div className={labelCls}>Vendor</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input value={pushEditDraft.vendorName} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, vendorName: e.target.value } : prev)} className={inputCls} placeholder="Vendor Name" />
                          <input value={pushEditDraft.vendorPartNumber} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, vendorPartNumber: e.target.value } : prev)} className={inputCls} placeholder="Vendor Part #" />
                        </div>
                      </div>

                      {/* Pricing & Units */}
                      <div>
                        <div className={labelCls}>Pricing & Units</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                            <input value={pushEditDraft.unitCost} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, unitCost: e.target.value } : prev)} className={`${inputCls} pl-5`} placeholder="Unit Cost" type="number" step="0.01" />
                          </div>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                            <input value={pushEditDraft.sellPrice} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, sellPrice: e.target.value } : prev)} className={`${inputCls} pl-5`} placeholder="Sell Price" type="number" step="0.01" />
                          </div>
                          <input value={pushEditDraft.unitSpec} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, unitSpec: e.target.value } : prev)} className={inputCls} placeholder="Unit Spec (e.g. 410)" />
                          <input value={pushEditDraft.unitLabel} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, unitLabel: e.target.value } : prev)} className={inputCls} placeholder="Unit Label (e.g. W)" />
                        </div>
                      </div>

                      {/* Dimensions */}
                      <div>
                        <div className={labelCls}>Physical</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
                          <input value={pushEditDraft.length} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, length: e.target.value } : prev)} className={inputCls} placeholder="Length (in)" type="number" step="0.1" />
                          <input value={pushEditDraft.width} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, width: e.target.value } : prev)} className={inputCls} placeholder="Width (in)" type="number" step="0.1" />
                          <input value={pushEditDraft.weight} onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, weight: e.target.value } : prev)} className={inputCls} placeholder="Weight (lbs)" type="number" step="0.1" />
                          <label className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={pushEditDraft.hardToProcure}
                              onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, hardToProcure: e.target.checked } : prev)}
                              className="rounded border-t-border"
                            />
                            Hard to Procure
                          </label>
                        </div>
                      </div>

                      {/* Systems */}
                      <div>
                        <div className={labelCls}>Target Systems</div>
                        <div className="flex flex-wrap gap-1.5">
                          {SYSTEM_OPTIONS.map((system) => {
                            const checked = pushEditDraft.systems.includes(system);
                            return (
                              <label
                                key={system}
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs cursor-pointer ring-1 ${checked ? "bg-cyan-500/15 text-cyan-400 ring-cyan-500/30" : "bg-surface text-muted ring-[color:var(--border)]"}`}
                              >
                                <input type="checkbox" checked={checked} onChange={() => togglePushSystem(system)} className="sr-only" />
                                {formatSystemLabel(system)}
                              </label>
                            );
                          })}
                        </div>
                        {pushEditDraft.systems.includes("QUICKBOOKS") && (
                          <input
                            value={pushEditDraft.quickbooksItemId}
                            onChange={(e) => setPushEditDraft((prev) => prev ? { ...prev, quickbooksItemId: e.target.value } : prev)}
                            className={`${inputCls} mt-2 max-w-xs`}
                            placeholder="QuickBooks Item ID (optional)"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* Dedup Tab */}
      {tab === "dedup" && syncEnabled && (
        <DedupPanel />
      )}

      {/* Sync Modal */}
      {syncSkuId && (
        <SyncModal
          skuId={syncSkuId}
          skuName={syncSkuName}
          isOpen={!!syncSkuId}
          onClose={() => { setSyncSkuId(null); setSyncSkuName(""); }}
          onSyncComplete={fetchSkus}
        />
      )}

      {/* Single-item cleanup modal */}
      {cleanupSkuId && cleanupSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl border border-t-border bg-surface shadow-card-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-t-border px-4 py-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-amber-400">SKU Cleanup</div>
                <div className="text-sm text-foreground truncate">
                  {cleanupSku.brand} — {cleanupSku.model}
                </div>
              </div>
              <button
                type="button"
                onClick={closeCleanupModal}
                disabled={cleanupRunning}
                className="px-2 py-1 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Internal action */}
              <div className="rounded-lg border border-t-border bg-background/40 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted">Internal action</div>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="radio"
                      name="cleanup-action"
                      checked={cleanupAction === "unlink"}
                      onChange={() => setCleanupAction("unlink")}
                    />
                    Unlink source IDs
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="radio"
                      name="cleanup-action"
                      checked={cleanupAction === "deactivate"}
                      onChange={() => setCleanupAction("deactivate")}
                    />
                    Deactivate SKU
                  </label>
                </div>
              </div>

              {/* External cleanup */}
              <div className="rounded-lg border border-t-border bg-background/40 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={cleanupExternal}
                    onChange={(e) => {
                      setCleanupExternal(e.target.checked);
                      if (!e.target.checked) setCleanupSources([]);
                    }}
                  />
                  Run external cleanup (archive/delete in source systems)
                </label>
                {cleanupExternal && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {CLEANUP_LINKABLE_SOURCES.map((source) => {
                      const sourceField = {
                        hubspot: "hubspotProductId",
                        zuper: "zuperItemId",
                        zoho: "zohoItemId",
                        quickbooks: "quickbooksItemId",
                      } as const;
                      const hasLink = Boolean(cleanupSku[sourceField[source]]);
                      const sourceLabel = source === "hubspot" ? "HubSpot" : source.charAt(0).toUpperCase() + source.slice(1);
                      return (
                        <label key={source} className={`flex items-center gap-2 text-xs ${hasLink ? "text-foreground" : "text-muted/60"}`}>
                          <input
                            type="checkbox"
                            checked={cleanupSources.includes(source)}
                            disabled={!hasLink}
                            onChange={(e) => {
                              setCleanupSources((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, source])]
                                  : prev.filter((s) => s !== source)
                              );
                            }}
                          />
                          {sourceLabel} {hasLink ? "" : "(not linked)"}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sync IDs info */}
              <div className="rounded-lg border border-t-border bg-background/40 p-3 text-[11px] text-muted space-y-0.5">
                <div>Zoho: {cleanupSku.zohoItemId || "—"}</div>
                <div>HubSpot: {cleanupSku.hubspotProductId || "—"}</div>
                <div>Zuper: {cleanupSku.zuperItemId || "—"}</div>
                {/* QuickBooks deactivated */}
              </div>

              {/* Confirmation */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <div className="text-xs text-amber-200">
                  Type <span className="font-semibold">{CLEANUP_CONFIRM_TEXT}</span> to confirm.
                </div>
                <input
                  value={cleanupConfirmInput}
                  onChange={(e) => setCleanupConfirmInput(e.target.value)}
                  placeholder={CLEANUP_CONFIRM_TEXT}
                  className="w-full rounded border border-amber-500/30 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:border-amber-400/60"
                  disabled={cleanupRunning}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCleanupModal}
                  disabled={cleanupRunning}
                  className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runSingleCleanup()}
                  disabled={cleanupRunning || cleanupConfirmInput.trim().toUpperCase() !== CLEANUP_CONFIRM_TEXT}
                  className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {cleanupRunning ? "Running…" : "Run cleanup"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
