"use client";

import { useState } from "react";
import DedupHistory from "./DedupHistory";

interface ClusterMember {
  name: string;
  item_id: string;
  sku: string | null;
  rate: number | null;
  stock_on_hand: number;
}

interface DedupCluster {
  canonicalKey: string;
  members: ClusterMember[];
  recommendedKeepId: string;
  hasStockConflict: boolean;
}

interface ClusterDecision {
  keepId: string;
  deleteIds: string[];
}

interface ExecuteOutcome {
  itemId: string;
  name: string;
  status: "deleted" | "skipped" | "failed";
  message?: string;
}

type DedupView = "scan" | "history";

export default function DedupPanel() {
  const [view, setView] = useState<DedupView>("scan");
  const [scanning, setScanning] = useState(false);
  const [clusters, setClusters] = useState<DedupCluster[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  // Per-cluster keep selection overrides
  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});

  // Confirmation + execution
  const [confirmText, setConfirmText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [outcomes, setOutcomes] = useState<ExecuteOutcome[] | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setClusters([]);
    setScanned(false);
    setOutcomes(null);
    setExecuteError(null);
    setConfirmText("");
    setKeepOverrides({});
    try {
      const res = await fetch("/api/catalog/zoho-dedup", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setClusters(data.clusters || []);
      setScanned(true);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function getKeepId(cluster: DedupCluster): string {
    return keepOverrides[cluster.canonicalKey] || cluster.recommendedKeepId;
  }

  function getDeleteIds(cluster: DedupCluster): string[] {
    const keepId = getKeepId(cluster);
    return cluster.members
      .filter((m) => m.item_id !== keepId && m.stock_on_hand <= 0)
      .map((m) => m.item_id);
  }

  function buildDecisions(): ClusterDecision[] {
    return clusters
      .map((cluster) => ({
        keepId: getKeepId(cluster),
        deleteIds: getDeleteIds(cluster),
      }))
      .filter((d) => d.deleteIds.length > 0);
  }

  const totalDeletes = clusters.reduce((sum, c) => sum + getDeleteIds(c).length, 0);
  const isConfirmed = confirmText.trim().toUpperCase() === "CONFIRM";

  async function handleExecute() {
    setExecuting(true);
    setExecuteError(null);
    try {
      const decisions = buildDecisions();
      if (decisions.length === 0) {
        setExecuteError("No items selected for deletion.");
        setExecuting(false);
        return;
      }

      // Step 1: Get HMAC token
      const confirmRes = await fetch("/api/catalog/zoho-dedup/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", clusters: decisions }),
      });
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get confirmation token");
      }
      const { token, issuedAt } = await confirmRes.json();

      // Step 2: Execute
      const executeRes = await fetch("/api/catalog/zoho-dedup/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", token, issuedAt, clusters: decisions }),
      });
      if (!executeRes.ok) {
        const data = await executeRes.json().catch(() => ({}));
        throw new Error(data.error || "Execution failed");
      }
      const result = await executeRes.json();
      setOutcomes(result.outcomes || []);
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setView("scan")}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            view === "scan"
              ? "bg-cyan-500/15 text-cyan-500"
              : "text-muted hover:text-foreground"
          }`}
        >
          Scan &amp; Clean
        </button>
        <button
          onClick={() => setView("history")}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            view === "history"
              ? "bg-cyan-500/15 text-cyan-500"
              : "text-muted hover:text-foreground"
          }`}
        >
          History
        </button>
      </div>

      {view === "history" && <DedupHistory />}

      {view === "scan" && (
        <div className="space-y-4">
          {/* Scan button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors"
            >
              {scanning ? "Scanning Zoho..." : "Scan Zoho for Duplicates"}
            </button>
            {scanned && !scanning && (
              <span className="text-sm text-muted">
                Found {clusters.length} duplicate cluster{clusters.length !== 1 ? "s" : ""}
                {totalDeletes > 0 && ` · ${totalDeletes} item${totalDeletes !== 1 ? "s" : ""} to delete`}
              </span>
            )}
          </div>

          {scanError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {scanError}
            </div>
          )}

          {scanning && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
              <span className="ml-2 text-sm text-muted">Harvesting and clustering Zoho items...</span>
            </div>
          )}

          {/* Results after execution */}
          {outcomes && (
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">Cleanup Results</h3>
              {outcomes.map((o, i) => (
                <div key={`${o.itemId}-${i}`} className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
                  <div>
                    <span className="font-medium text-foreground">{o.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted">{o.itemId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      o.status === "deleted"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : o.status === "failed"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {o.status}
                    </span>
                    {o.message && <span className="text-xs text-muted">{o.message}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cluster cards */}
          {scanned && !outcomes && clusters.length > 0 && (
            <div className="space-y-4">
              {clusters.map((cluster) => {
                const keepId = getKeepId(cluster);
                return (
                  <div key={cluster.canonicalKey} className="rounded-lg border border-border bg-surface-2 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        {cluster.canonicalKey.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-muted">
                        {cluster.members.length} items
                      </span>
                    </div>

                    <div className="space-y-2">
                      {cluster.members.map((member) => {
                        const isKept = member.item_id === keepId;
                        const hasStock = member.stock_on_hand > 0;
                        const willDelete = !isKept && !hasStock;
                        return (
                          <label
                            key={member.item_id}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer ${
                              isKept
                                ? "bg-green-500/10 border border-green-500/30"
                                : willDelete
                                  ? "bg-red-500/5 border border-red-500/20"
                                  : "bg-surface border border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`keep-${cluster.canonicalKey}`}
                              checked={isKept}
                              onChange={() =>
                                setKeepOverrides((prev) => ({
                                  ...prev,
                                  [cluster.canonicalKey]: member.item_id,
                                }))
                              }
                              className="accent-green-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-foreground truncate">{member.name}</span>
                                {isKept && (
                                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                    KEEP
                                  </span>
                                )}
                                {hasStock && !isKept && (
                                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                                    HAS STOCK — protected
                                  </span>
                                )}
                                {willDelete && (
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                    DELETE
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-4 text-xs text-muted mt-0.5">
                                <span>ID: {member.item_id}</span>
                                {member.sku && <span>SKU: {member.sku}</span>}
                                <span>Price: {member.rate != null ? `$${member.rate}` : "—"}</span>
                                <span>Stock: {member.stock_on_hand}</span>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Confirmation + execute */}
              {totalDeletes > 0 && (
                <div className="space-y-3 border-t border-border pt-4">
                  {executeError && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      {executeError}
                    </div>
                  )}
                  <label className="block text-sm text-muted">
                    Type <strong className="text-foreground">CONFIRM</strong> to delete{" "}
                    {totalDeletes} Zoho item{totalDeletes !== 1 ? "s" : ""}:
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CONFIRM"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground placeholder:text-muted focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    disabled={executing}
                  />
                  <button
                    onClick={handleExecute}
                    disabled={!isConfirmed || executing}
                    className="w-full rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {executing ? "Deleting..." : `Delete ${totalDeletes} Duplicate Item${totalDeletes !== 1 ? "s" : ""}`}
                  </button>
                </div>
              )}

              {totalDeletes === 0 && (
                <div className="rounded-lg bg-green-50 p-4 text-center text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                  No items can be deleted — all duplicates either have stock or are marked as keep.
                </div>
              )}
            </div>
          )}

          {scanned && !scanning && clusters.length === 0 && !outcomes && (
            <div className="rounded-lg bg-green-50 p-6 text-center text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
              No duplicate clusters found in Zoho Inventory.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
