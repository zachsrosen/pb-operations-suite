"use client";

import { useState, useEffect, useCallback } from "react";

interface SyncFieldChange {
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
}

interface SyncPreview {
  system: string;
  externalId: string | null;
  linked: boolean;
  action: "update" | "create" | "skip";
  changes: SyncFieldChange[];
  noChanges: boolean;
}

interface SyncOutcome {
  system: string;
  externalId: string;
  status: "updated" | "created" | "skipped" | "failed" | "unsupported";
  message: string;
}

interface SyncModalProps {
  skuId: string;
  skuName: string;
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: () => void;
}

const SYSTEM_LABELS: Record<string, string> = {
  zoho: "Zoho Inventory",
  hubspot: "HubSpot",
  zuper: "Zuper",
};

const STATUS_COLORS: Record<string, string> = {
  updated: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  created: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  skipped: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  unsupported: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

export default function SyncModal({ skuId, skuName, isOpen, onClose, onSyncComplete }: SyncModalProps) {
  const [previews, setPreviews] = useState<SyncPreview[]>([]);
  const [changesHash, setChangesHash] = useState("");
  const [systems, setSystems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [outcomes, setOutcomes] = useState<SyncOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/skus/${skuId}/sync`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPreviews(data.previews || []);
      setChangesHash(data.changesHash || "");
      setSystems(data.systems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    if (isOpen) {
      fetchPreview();
      setConfirmText("");
      setOutcomes(null);
      setError(null);
    }
  }, [isOpen, fetchPreview]);

  const handleConfirmAndSync = async () => {
    setExecuting(true);
    setError(null);
    try {
      // Step 1: Get HMAC token
      const confirmRes = await fetch(`/api/inventory/skus/${skuId}/sync/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systems, changesHash }),
      });
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get confirmation token");
      }
      const { token, issuedAt } = await confirmRes.json();

      // Step 2: Execute sync
      const executeRes = await fetch(`/api/inventory/skus/${skuId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, issuedAt, systems }),
      });
      if (!executeRes.ok) {
        const data = await executeRes.json().catch(() => ({}));
        throw new Error(data.error || "Sync execution failed");
      }
      const result = await executeRes.json();
      setOutcomes(result.outcomes || []);
      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  const hasChanges = previews.some((p) => !p.noChanges);
  const isConfirmed = confirmText.trim().toUpperCase() === "CONFIRM";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface mx-4 max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border p-6 shadow-card-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Sync: {skuName}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none">&times;</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            <span className="ml-3 text-muted">Loading preview...</span>
          </div>
        )}

        {outcomes && (
          <div className="space-y-3">
            <h3 className="font-medium text-foreground">Sync Results</h3>
            {outcomes.map((outcome) => (
              <div key={outcome.system} className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
                <span className="font-medium text-foreground">{SYSTEM_LABELS[outcome.system] || outcome.system}</span>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[outcome.status] || ""}`}>
                    {outcome.status}
                  </span>
                  <span className="text-xs text-muted">{outcome.message}</span>
                </div>
              </div>
            ))}
            <button
              onClick={onClose}
              className="mt-4 w-full rounded-lg bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600"
            >
              Close
            </button>
          </div>
        )}

        {!loading && !outcomes && previews.length > 0 && (
          <div className="space-y-4">
            {previews.map((preview) => (
              <div key={preview.system} className="rounded-lg border border-border bg-surface-2 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-foreground">{SYSTEM_LABELS[preview.system] || preview.system}</span>
                  {preview.noChanges && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      No changes
                    </span>
                  )}
                  {!preview.linked && preview.action === "create" && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      Will create
                    </span>
                  )}
                </div>

                {preview.changes.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-1 pr-4">Field</th>
                        <th className="pb-1 pr-4">Current</th>
                        <th className="pb-1">Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((change) => (
                        <tr key={change.field} className="border-t border-border/50">
                          <td className="py-1.5 pr-4 font-mono text-xs text-muted">{change.field}</td>
                          <td className="py-1.5 pr-4 text-red-500 line-through">
                            {change.currentValue || <span className="text-muted italic">empty</span>}
                          </td>
                          <td className="py-1.5 text-green-600 dark:text-green-400">
                            {change.proposedValue || <span className="text-muted italic">empty</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}

            {hasChanges && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <label className="block text-sm text-muted">
                  Type <strong className="text-foreground">CONFIRM</strong> to sync changes to external systems:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground placeholder:text-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  disabled={executing}
                />
                <button
                  onClick={handleConfirmAndSync}
                  disabled={!isConfirmed || executing}
                  className="w-full rounded-lg bg-orange-500 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {executing ? "Syncing..." : "Sync to External Systems"}
                </button>
              </div>
            )}

            {!hasChanges && (
              <div className="mt-4 rounded-lg bg-green-50 p-4 text-center text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                All external systems are in sync. No changes needed.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
