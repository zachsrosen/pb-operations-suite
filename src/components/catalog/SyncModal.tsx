"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

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
  internalProductId: string;
  skuName: string;
  isOpen: boolean;
  onClose: () => void;
}

type FieldDirection = "push" | "pull" | "skip";

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

/** Maps external system field name → internal product field for reverse sync */
const PULL_FIELD_MAP: Record<string, Record<string, string>> = {
  hubspot: {
    name: "model",
    price: "sellPrice",
    hs_cost_of_goods_sold: "unitCost",
    description: "description",
    hs_sku: "sku",
    manufacturer: "brand",
  },
  zoho: {
    name: "model",
    rate: "sellPrice",
    purchase_rate: "unitCost",
    description: "description",
    sku: "sku",
    vendor_name: "vendorName",
    vendor_id: "zohoVendorId",
  },
  zuper: {
    name: "model",
    sku: "sku",
    description: "description",
  },
};

/** Fields that must be pulled together (e.g. vendor name requires vendor ID). */
const COMPANION_FIELDS: Record<string, Record<string, string>> = {
  zoho: { vendor_name: "vendor_id" },
};

const NUMERIC_INTERNAL_FIELDS = new Set(["sellPrice", "unitCost"]);

/** Mirrors server's computePreviewHash using Web Crypto API */
async function computePreviewHashClient(previews: SyncPreview[]): Promise<string> {
  const sorted = [...previews].sort((a, b) => a.system.localeCompare(b.system));
  const canonical = sorted.map((p) => ({
    system: p.system,
    externalId: p.externalId,
    action: p.action,
    changes: [...p.changes].sort((a, b) => a.field.localeCompare(b.field)),
  }));
  const data = new TextEncoder().encode(JSON.stringify(canonical));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function SyncModal({ internalProductId, skuName, isOpen, onClose }: SyncModalProps) {
  const [previews, setPreviews] = useState<SyncPreview[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [outcomes, setOutcomes] = useState<SyncOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Selective sync state
  const [disabledSystems, setDisabledSystems] = useState<Set<string>>(new Set());
  const [fieldDirections, setFieldDirections] = useState<Record<string, Record<string, FieldDirection>>>({});

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${internalProductId}/sync`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPreviews(data.previews || []);
      setSystems(data.systems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [internalProductId]);

  useEffect(() => {
    if (isOpen) {
      fetchPreview();
      setConfirmText("");
      setOutcomes(null);
      setError(null);
      setDisabledSystems(new Set());
      setFieldDirections({});
    }
  }, [isOpen, fetchPreview]);

  const toggleSystem = (system: string) => {
    setDisabledSystems((prev) => {
      const next = new Set(prev);
      if (next.has(system)) next.delete(system);
      else next.add(system);
      return next;
    });
  };

  const cycleFieldDirection = (system: string, field: string, target: FieldDirection) => {
    setFieldDirections((prev) => {
      const current = prev[system]?.[field] ?? "push";
      const next = current === target && target !== "push" ? "push" : target;
      return { ...prev, [system]: { ...prev[system], [field]: next } };
    });
  };

  const getDirection = (system: string, field: string): FieldDirection => {
    return fieldDirections[system]?.[field] ?? "push";
  };

  const activePushPreviews = useMemo(() => {
    return previews
      .filter((p) => !disabledSystems.has(p.system))
      .map((p) => {
        if (p.action !== "update") return p;
        const filteredChanges = p.changes.filter(
          (c) => (fieldDirections[p.system]?.[c.field] ?? "push") === "push",
        );
        return { ...p, changes: filteredChanges };
      });
  }, [previews, disabledSystems, fieldDirections]);

  const pullFields = useMemo(() => {
    const pulls: Record<string, SyncFieldChange[]> = {};
    for (const preview of previews) {
      if (disabledSystems.has(preview.system)) continue;
      if (preview.action !== "update") continue;
      const pullChanges = preview.changes.filter(
        (c) => (fieldDirections[preview.system]?.[c.field] ?? "push") === "pull",
      );
      if (pullChanges.length > 0) pulls[preview.system] = pullChanges;
    }
    return pulls;
  }, [previews, disabledSystems, fieldDirections]);

  const hasActiveChanges = useMemo(() => {
    const hasPush = activePushPreviews.some((p) => !p.noChanges && p.changes.length > 0);
    const hasPull = Object.keys(pullFields).length > 0;
    return hasPush || hasPull;
  }, [activePushPreviews, pullFields]);

  const handleConfirmAndSync = async () => {
    setExecuting(true);
    setError(null);
    try {
      const activeSystems = activePushPreviews.map((p) => p.system);
      const allOutcomes: SyncOutcome[] = [];

      const excludedFieldsPayload: Record<string, string[]> = {};
      for (const preview of previews) {
        if (disabledSystems.has(preview.system)) continue;
        if (preview.action !== "update") continue;
        const excluded = preview.changes
          .filter((c) => (fieldDirections[preview.system]?.[c.field] ?? "push") !== "push")
          .map((c) => c.field);
        if (excluded.length > 0) excludedFieldsPayload[preview.system] = excluded;
      }

      const hasPushChanges = activePushPreviews.some(
        (p) => !p.noChanges && p.changes.length > 0,
      );

      if (hasPushChanges && activeSystems.length > 0) {
        const filteredHash = await computePreviewHashClient(activePushPreviews);

        const confirmRes = await fetch(
          `/api/inventory/products/${internalProductId}/sync/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systems: activeSystems, changesHash: filteredHash }),
          },
        );
        if (!confirmRes.ok) {
          const data = await confirmRes.json().catch(() => ({}));
          throw new Error(data.error || "Failed to get confirmation token");
        }
        const { token, issuedAt } = await confirmRes.json();

        const executeRes = await fetch(
          `/api/inventory/products/${internalProductId}/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              issuedAt,
              systems: activeSystems,
              changesHash: filteredHash,
              ...(Object.keys(excludedFieldsPayload).length > 0
                ? { excludedFields: excludedFieldsPayload }
                : {}),
            }),
          },
        );
        if (!executeRes.ok) {
          const data = await executeRes.json().catch(() => ({}));
          throw new Error(data.error || "Sync execution failed");
        }
        const result = await executeRes.json();
        allOutcomes.push(...(result.outcomes || []));
      }

      if (Object.keys(pullFields).length > 0) {
        const updatePayload: Record<string, string | number | null> = {};
        for (const [system, changes] of Object.entries(pullFields)) {
          // Collect pulled field names so we can resolve companions
          const pulledFields = new Set(changes.map((c) => c.field));

          for (const change of changes) {
            const internalField = PULL_FIELD_MAP[system]?.[change.field];
            if (!internalField) continue;
            if (NUMERIC_INTERNAL_FIELDS.has(internalField) && change.currentValue != null) {
              const n = Number(change.currentValue);
              if (Number.isFinite(n)) updatePayload[internalField] = n;
            } else {
              updatePayload[internalField] = change.currentValue;
            }

            // Auto-pull companion fields (e.g. vendor_name requires vendor_id)
            const companion = COMPANION_FIELDS[system]?.[change.field];
            if (companion && !pulledFields.has(companion)) {
              const companionInternal = PULL_FIELD_MAP[system]?.[companion];
              if (companionInternal) {
                // Find companion value from the full preview data
                const systemPreview = previews.find((p) => p.system === system);
                const companionChange = systemPreview?.changes.find((c) => c.field === companion);
                if (companionChange) {
                  updatePayload[companionInternal] = companionChange.currentValue;
                }
              }
            }
          }
        }

        if (Object.keys(updatePayload).length > 0) {
          const patchRes = await fetch("/api/inventory/products", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: internalProductId, ...updatePayload }),
          });
          allOutcomes.push({
            system: "internal",
            externalId: internalProductId,
            status: patchRes.ok ? "updated" : "failed",
            message: patchRes.ok
              ? `Pulled ${Object.keys(updatePayload).length} field(s) to internal product.`
              : "Failed to update internal product.",
          });
        }
      }

      setOutcomes(
        allOutcomes.length > 0
          ? allOutcomes
          : [{ system: "all", externalId: "", status: "skipped", message: "No changes to sync." }],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  const isConfirmed = confirmText.trim().toUpperCase() === "CONFIRM";
  const originalHasChanges = previews.some((p) => !p.noChanges);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface mx-4 max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border p-6 shadow-card-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Sync: {skuName}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none">
            &times;
          </button>
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
                <span className="font-medium text-foreground">
                  {outcome.system === "internal"
                    ? "Internal Product"
                    : (SYSTEM_LABELS[outcome.system] || outcome.system)}
                </span>
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
            {originalHasChanges && previews.some((p) => p.action === "update" && !p.noChanges) && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                <span>Per-field sync direction:</span>
                <span className="flex items-center gap-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-green-500 text-[10px] text-white">&rarr;</span>
                  Push
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-500 text-[10px] text-white">&larr;</span>
                  Pull
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-zinc-500 text-[10px] text-white">&mdash;</span>
                  Skip
                </span>
              </div>
            )}

            {previews.map((preview) => {
              const isSystemDisabled = disabledSystems.has(preview.system);
              const hasSystemChanges = !preview.noChanges && preview.changes.length > 0;

              return (
                <div
                  key={preview.system}
                  className={`rounded-lg border border-border bg-surface-2 p-4 transition-opacity ${
                    isSystemDisabled ? "opacity-40" : ""
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2">
                      {hasSystemChanges && (
                        <input
                          type="checkbox"
                          checked={!isSystemDisabled}
                          onChange={() => toggleSystem(preview.system)}
                          className="h-4 w-4 rounded accent-orange-500"
                        />
                      )}
                      <span className="font-medium text-foreground">
                        {SYSTEM_LABELS[preview.system] || preview.system}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
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
                      {preview.linked && preview.action === "update" && !preview.noChanges && !isSystemDisabled && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                          Will update
                        </span>
                      )}
                    </div>
                  </div>

                  {preview.changes.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          {preview.action === "update" && <th className="w-[72px] pb-1" />}
                          <th className="pb-1 pr-4">Field</th>
                          <th className="pb-1 pr-4">Current</th>
                          <th className="pb-1">Proposed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.changes.map((change) => {
                          const direction = getDirection(preview.system, change.field);
                          const isSkipped = direction === "skip" || isSystemDisabled;
                          const isPull = direction === "pull" && !isSystemDisabled;
                          const isPush = direction === "push" && !isSystemDisabled;

                          return (
                            <tr
                              key={change.field}
                              className={`border-t border-border/50 transition-opacity ${isSkipped ? "opacity-40" : ""}`}
                            >
                              {preview.action === "update" && (
                                <td className="py-1.5 pr-2">
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={() => cycleFieldDirection(preview.system, change.field, "pull")}
                                      disabled={isSystemDisabled}
                                      title="Pull from external"
                                      className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                                        isPull
                                          ? "bg-blue-500 text-white"
                                          : "bg-surface text-muted hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                                      } disabled:cursor-not-allowed disabled:opacity-30`}
                                    >
                                      &larr;
                                    </button>
                                    <button
                                      onClick={() => cycleFieldDirection(preview.system, change.field, "skip")}
                                      disabled={isSystemDisabled}
                                      title="Skip this field"
                                      className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                                        direction === "skip"
                                          ? "bg-zinc-500 text-white"
                                          : "bg-surface text-muted hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                                      } disabled:cursor-not-allowed disabled:opacity-30`}
                                    >
                                      &mdash;
                                    </button>
                                    <button
                                      onClick={() => cycleFieldDirection(preview.system, change.field, "push")}
                                      disabled={isSystemDisabled}
                                      title="Push to external"
                                      className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                                        isPush
                                          ? "bg-green-500 text-white"
                                          : "bg-surface text-muted hover:bg-green-100 hover:text-green-700 dark:hover:bg-green-900/30 dark:hover:text-green-300"
                                      } disabled:cursor-not-allowed disabled:opacity-30`}
                                    >
                                      &rarr;
                                    </button>
                                  </div>
                                </td>
                              )}
                              <td className="py-1.5 pr-4 font-mono text-xs text-muted">{change.field}</td>
                              <td
                                className={`max-w-[200px] truncate py-1.5 pr-4 ${
                                  isPull
                                    ? "font-medium text-green-600 dark:text-green-400"
                                    : "text-red-500 line-through"
                                }`}
                              >
                                {change.currentValue || <span className="text-muted italic no-underline">empty</span>}
                              </td>
                              <td
                                className={`max-w-[200px] truncate py-1.5 ${
                                  isPull ? "text-red-500 line-through" : "text-green-600 dark:text-green-400"
                                }`}
                              >
                                {change.proposedValue || <span className="text-muted italic no-underline">empty</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}

            {hasActiveChanges && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <label className="block text-sm text-muted">
                  Type <strong className="text-foreground">CONFIRM</strong> to sync selected changes:
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
                  {executing ? "Syncing..." : "Sync Selected Changes"}
                </button>
              </div>
            )}

            {!originalHasChanges && (
              <div className="mt-4 rounded-lg bg-green-50 p-4 text-center text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                All external systems are in sync. No changes needed.
              </div>
            )}

            {originalHasChanges && !hasActiveChanges && (
              <div className="mt-4 rounded-lg bg-zinc-50 p-4 text-center text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                All changes have been skipped. Toggle fields above to sync.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
