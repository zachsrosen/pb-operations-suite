// src/components/catalog/SyncModal.tsx
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type {
  ExternalSystem,
  FieldMappingEdge,
  FieldValueSnapshot,
  SyncOperationOutcome,
  SyncPlan,
} from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";
import {
  selectionToIntents,
  computeSmartDefaults,
  getDropdownOptions,
} from "@/lib/selection-to-intents";
import type { CellSelection, FieldRow, DropdownOption } from "@/lib/selection-to-intents";
import { normalizedEqual } from "@/lib/catalog-sync-mappings";

// ── Types ──

type Step = "loading" | "table" | "executing" | "results";

/** Per-cell selection keyed by `${system}:${externalField}` for external columns
 *  or `internal:${internalField}` for the internal column. */
type SelectionMap = Record<string, "keep" | "internal" | ExternalSystem | "custom">;

const SYSTEM_LABELS: Record<ExternalSystem, string> = {
  zoho: "Zoho Inventory",
  hubspot: "HubSpot",
  zuper: "Zuper",
};

const SYSTEM_SHORT: Record<ExternalSystem, string> = {
  zoho: "Zoho",
  hubspot: "HubSpot",
  zuper: "Zuper",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  model: "Model",
  sku: "SKU",
  category: "Category",
  sellPrice: "Sell Price",
  unitCost: "Unit Cost",
  unitLabel: "Unit Label",
  description: "Description",
  vendorName: "Vendor",
  zohoVendorId: "Vendor ID",
  dc_size: "DC Size (W)",
  wattage: "Wattage",
  efficiency: "Efficiency (%)",
  acOutputKw: "AC Output (kW)",
  ac_output: "AC Output (W)",
  capacityKwh: "Capacity (kWh)",
  powerKw: "Power (kW)",
  connectorType: "Connector Type",
  mountType: "Mount Type",
  componentType: "Component Type",
  deviceType: "Device Type",
};

/** Maps external system to the InternalProduct DB column used for linking. */
const LINK_FIELDS: Record<ExternalSystem, string> = {
  zoho: "zohoItemId",
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
};

/** Cached product from /api/products/cache. */
interface CachedProduct {
  id: number;
  externalId: string;
  name: string;
  sku: string | null;
  source: string;
}

// ── Exported pure helpers (testable) ──

/**
 * Group mapping edges into FieldRows, partitioned into "attention" (has diffs)
 * and "inSync" (all values agree).
 */
export function buildFieldRows(
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  linkedSystems: Record<ExternalSystem, boolean>,
): { attention: FieldRow[]; inSync: FieldRow[] } {
  // Group edges by internalField
  const byInternal = new Map<string, FieldMappingEdge[]>();
  for (const edge of mappings) {
    // Skip companion duplicates — only show the primary field
    if (edge.companion && edge.internalField === "zohoVendorId") continue;
    const key = edge.internalField;
    if (!byInternal.has(key)) byInternal.set(key, []);
    byInternal.get(key)!.push(edge);
  }

  const attention: FieldRow[] = [];
  const inSync: FieldRow[] = [];

  for (const [internalField, edges] of byInternal) {
    const isPushOnly = edges.every((e) => e.direction === "push-only");

    const label = FIELD_LABELS[internalField] ?? internalField;

    const row: FieldRow = {
      internalField,
      label,
      isPushOnly,
      edges,
    };

    // Determine if this row needs attention
    const internalValue = getSnapshotValue(snapshots, "internal", internalField);
    let hasDiff = false;

    for (const edge of edges) {
      if (!linkedSystems[edge.system]) continue;
      const extValue = getSnapshotValue(snapshots, edge.system, edge.externalField);
      if (!normalizedEqual(internalValue, extValue, edge.normalizeWith)) {
        hasDiff = true;
        break;
      }
    }

    if (hasDiff) {
      attention.push(row);
    } else {
      // Skip rows where ALL values (internal + linked externals) are empty
      const allEmpty = isEmptyish(internalValue) &&
        edges.every((e) => {
          if (!linkedSystems[e.system]) return true;
          return isEmptyish(getSnapshotValue(snapshots, e.system, e.externalField));
        });
      if (!allEmpty) {
        inSync.push(row);
      }
    }
  }

  // Sort by label
  attention.sort((a, b) => a.label.localeCompare(b.label));
  inSync.sort((a, b) => a.label.localeCompare(b.label));

  return { attention, inSync };
}

/**
 * Get the projected value for a cell given the selected source.
 */
export function getProjectedValue(
  source: "keep" | "internal" | ExternalSystem | "custom",
  internalField: string,
  externalField: string,
  system: ExternalSystem,
  snapshots: FieldValueSnapshot[],
  mappings: FieldMappingEdge[],
  customValue?: string | null,
): string | number | null {
  if (source === "keep") {
    return getSnapshotValue(snapshots, system, externalField);
  }
  if (source === "internal") {
    return getSnapshotValue(snapshots, "internal", internalField);
  }
  if (source === "custom") {
    return customValue ?? null;
  }
  // Source is another external system — find its value for this internalField
  const sourceEdge = mappings.find(
    (e) => e.system === source && e.internalField === internalField,
  );
  if (!sourceEdge) return null;
  return getSnapshotValue(snapshots, source, sourceEdge.externalField);
}

/**
 * Get a list of implicit writes (auto-generated/companion fields) that will
 * happen alongside the explicit selections.
 */
export function getImplicitWrites(
  mappings: FieldMappingEdge[],
  selections: SelectionMap,
  _linkedSystems: Record<ExternalSystem, boolean>,
): string[] {
  const implicit: string[] = [];
  const seen = new Set<string>();

  // Companion fields that auto-apply
  for (const edge of mappings) {
    if (!edge.companion) continue;
    // Check if primary is selected with non-keep
    const key = `${edge.system}:${edge.externalField}`;
    const sel = selections[key];
    if (sel && sel !== "keep") {
      const companionEdge = mappings.find(
        (e) => e.system === edge.system && e.externalField === edge.companion,
      );
      if (companionEdge) {
        const label = FIELD_LABELS[companionEdge.internalField] ?? companionEdge.internalField;
        const desc = `${label} (companion)`;
        if (!seen.has(desc)) {
          seen.add(desc);
          implicit.push(desc);
        }
      }
    }
  }

  return implicit;
}

/**
 * Count the number of fields and systems that will change.
 */
export function countChanges(selections: SelectionMap): { fields: number; systems: Set<string> } {
  const systems = new Set<string>();
  let fields = 0;
  for (const [key, value] of Object.entries(selections)) {
    if (value === "keep") continue;
    fields++;
    const parts = key.split(":");
    systems.add(parts[0]);
  }
  return { fields, systems };
}

// ── Internal helpers ──

function getSnapshotValue(
  snapshots: FieldValueSnapshot[],
  system: ExternalSystem | "internal",
  field: string,
): string | number | null {
  const raw = snapshots.find((s) => s.system === system && s.field === field)?.rawValue ?? null;
  return decodeValue(raw);
}

/** True when a snapshot value is effectively empty (null, "", or em-dash). */
function isEmptyish(v: string | number | null): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" || s === "\u2014" || s === "\\u2014";
  }
  return false;
}

/** Decode literal unicode escapes (e.g. `\u2014`) that arrive as raw text from API snapshots. */
function decodeValue(v: string | number | null): string | number | null {
  if (typeof v === "string")
    return v
      .replace(/\\u2014/g, "\u2014")
      .replace(/\\u[\da-fA-F]{4}/g, (m) =>
        String.fromCharCode(parseInt(m.slice(2), 16)),
      );
  return v;
}

function formatValue(val: string | number | null): string {
  if (val === null || val === undefined || val === "") return "\u2014";
  return String(decodeValue(val));
}

/** Truncate a string to maxLen chars, appending "\u2026" if cut. */
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "\u2026" : s;
}

// ── Component ──

interface SyncModalProps {
  internalProductId: string;
  skuName: string;
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: () => void;
}

export default function SyncModal({
  internalProductId,
  skuName,
  isOpen,
  onClose,
  onSyncComplete,
}: SyncModalProps) {
  // ── State ──
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<FieldValueSnapshot[]>([]);
  const [mappings, setMappings] = useState<FieldMappingEdge[]>([]);
  const [selections, setSelections] = useState<SelectionMap>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [createToggles, setCreateToggles] = useState<Record<ExternalSystem, boolean>>({
    zoho: false,
    hubspot: false,
    zuper: false,
  });
  const [showInSync, setShowInSync] = useState(false);
  const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);
  const [linkingSystem, setLinkingSystem] = useState<ExternalSystem | null>(null);

  // ── Linked systems ──
  const linkedSystems = useMemo<Record<ExternalSystem, boolean>>(() => {
    const result = { zoho: false, hubspot: false, zuper: false };
    for (const sys of EXTERNAL_SYSTEMS) {
      result[sys] = snapshots.some((s) => s.system === sys);
    }
    return result;
  }, [snapshots]);

  const orderedSystems = useMemo<ExternalSystem[]>(() => {
    return [...EXTERNAL_SYSTEMS].sort((a, b) => SYSTEM_SHORT[a].localeCompare(SYSTEM_SHORT[b]));
  }, []);

  // ── Reset when modal opens ──
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    setStep("loading");
    setError(null);
    setOutcomes([]);
    setSelections({});
    setCustomValues({});
    setCreateToggles({ zoho: false, hubspot: false, zuper: false });
    setShowInSync(false);
  }
  if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  // ── Shared fetch logic ──
  const loadSyncData = useCallback(() => {
    fetch(`/api/inventory/products/${internalProductId}/sync`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load sync data");
        return r.json();
      })
      .then((data) => {
        const snaps: FieldValueSnapshot[] = data.snapshots;
        const maps: FieldMappingEdge[] = data.mappings;
        setSnapshots(snaps);
        setMappings(maps);

        // Compute linked systems inline for defaults
        const linked: Record<ExternalSystem, boolean> = {
          zoho: false,
          hubspot: false,
          zuper: false,
        };
        for (const sys of EXTERNAL_SYSTEMS) {
          linked[sys] = snaps.some((s: FieldValueSnapshot) => s.system === sys);
        }

        // Compute smart defaults
        const defaults = computeSmartDefaults(maps, snaps, linked);
        const selMap: SelectionMap = {};
        for (const d of defaults) {
          const key = `${d.system}:${d.externalField}`;
          selMap[key] = d.source;
        }
        setSelections(selMap);
        setStep("table");
      })
      .catch((err) => {
        setError(err.message);
        setStep("table");
      });
  }, [internalProductId]);

  // ── Fetch data on open ──
  useEffect(() => {
    if (!isOpen) return;
    loadSyncData();
  }, [isOpen, loadSyncData]);

  // ── Build rows ──
  const { attention, inSync } = useMemo(
    () => buildFieldRows(mappings, snapshots, linkedSystems),
    [mappings, snapshots, linkedSystems],
  );

  // ── Locked pull source per field ──
  // For each internal field, if ANY cell has already chosen an external source
  // (Internal column pull or external cell relay), that locks all other cells
  // on the same row to the same source. First external source wins.
  const lockedPullSources = useMemo(() => {
    const locked: Record<string, ExternalSystem | null> = {};

    // Pass 1: Internal column selections (highest priority)
    for (const [key, value] of Object.entries(selections)) {
      if (!key.startsWith("internal:")) continue;
      if (value === "keep" || value === "internal") continue;
      const internalField = key.split(":")[1];
      locked[internalField] = value as ExternalSystem;
    }

    // Pass 2: External cell relay selections
    // If no Internal column lock exists for a field, check if any external
    // cell has picked another external source (relay). That source locks the row.
    for (const [key, value] of Object.entries(selections)) {
      if (key.startsWith("internal:")) continue;
      if (value === "keep" || value === "internal" || value === "custom") continue;
      // value is an ExternalSystem (relay source)
      const parts = key.split(":");
      const cellSystem = parts[0] as ExternalSystem;
      const externalField = parts.slice(1).join(":");
      // Find the internalField for this cell
      const edge = mappings.find(
        (e) => e.system === cellSystem && e.externalField === externalField,
      );
      if (!edge) continue;
      // Only set if not already locked
      if (locked[edge.internalField] === undefined) {
        locked[edge.internalField] = value as ExternalSystem;
      }
    }

    return locked;
  }, [selections, mappings]);

  // ── Handlers ──

  const handleSelectionChange = useCallback(
    (key: string, value: "keep" | "internal" | ExternalSystem | "custom") => {
      setSelections((prev) => {
        const next = { ...prev, [key]: value };
        const isCustom = value === "custom";

        // Conflict prevention: if this is the Internal column changing,
        // reset any external cells for the same field that would conflict
        if (key.startsWith("internal:")) {
          const internalField = key.split(":")[1];
          if (value !== "keep" && value !== "internal" && value !== "custom") {
            // Lock: external cells for this field can only be keep/internal/value
            for (const sys of EXTERNAL_SYSTEMS) {
              for (const edge of mappings) {
                if (edge.system !== sys || edge.internalField !== internalField) continue;
                const extKey = `${sys}:${edge.externalField}`;
                const extSel = next[extKey];
                if (
                  extSel &&
                  extSel !== "keep" &&
                  extSel !== "internal" &&
                  extSel !== value &&
                  extSel !== "custom"
                ) {
                  // Conflicting source — reset to keep
                  next[extKey] = "keep";
                }
              }
            }
          }
          if (!isCustom) {
            setCustomValues((prevCustom) => {
              if (!(internalField in prevCustom)) return prevCustom;
              const copy = { ...prevCustom };
              delete copy[internalField];
              return copy;
            });
          }
        }

        return next;
      });
    },
    [mappings],
  );

  const handleCustomValueChange = useCallback((fieldKey: string, value: string) => {
    setCustomValues((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
    setSelections((prev) => {
      const next = { ...prev };
      next[`internal:${fieldKey}`] = "custom";
      for (const sys of EXTERNAL_SYSTEMS) {
        for (const edge of mappings) {
          if (edge.system !== sys || edge.internalField !== fieldKey) continue;
          next[`${sys}:${edge.externalField}`] = "custom";
        }
      }
      return next;
    });
  }, [mappings]);

  const handleCustomCancel = useCallback((fieldKey: string) => {
    setCustomValues((prev) => {
      if (!(fieldKey in prev)) return prev;
      const copy = { ...prev };
      delete copy[fieldKey];
      return copy;
    });
    setSelections((prev) => {
      const next = { ...prev };
      if (next[`internal:${fieldKey}`] === "custom") next[`internal:${fieldKey}`] = "keep";
      for (const sys of EXTERNAL_SYSTEMS) {
        for (const edge of mappings) {
          if (edge.system !== sys || edge.internalField !== fieldKey) continue;
          const key = `${sys}:${edge.externalField}`;
          if (next[key] === "custom") next[key] = "keep";
        }
      }
      return next;
    });
  }, [mappings]);

  const handleCreateToggle = useCallback(
    (system: ExternalSystem) => {
      setCreateToggles((prev) => {
        const newVal = !prev[system];
        const next = { ...prev, [system]: newVal };

        // When toggling on, set all cells for this system to "internal"
        // When toggling off, set all cells for this system to "keep"
        setSelections((prevSel) => {
          const updated = { ...prevSel };
          for (const edge of mappings) {
            if (edge.system !== system) continue;
            if (edge.direction === "push-only") continue;
            const key = `${system}:${edge.externalField}`;
            updated[key] = newVal ? "internal" : "keep";
          }
          return updated;
        });

        return next;
      });
    },
    [mappings],
  );

  const handleRetry = useCallback(() => {
    setError(null);
    setStep("loading");
    loadSyncData();
  }, [loadSyncData]);

  /** Link an existing external product to this InternalProduct, then reload sync data. */
  const handleLinkProduct = useCallback(
    async (system: ExternalSystem, externalId: string) => {
      setLinkingSystem(system);
      setError(null);
      try {
        const res = await fetch("/api/inventory/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: internalProductId,
            [LINK_FIELDS[system]]: externalId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to link ${SYSTEM_LABELS[system]} product`);
        }
        // Reload sync data so the column populates with real values
        loadSyncData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Link failed");
      } finally {
        setLinkingSystem(null);
      }
    },
    [internalProductId, loadSyncData],
  );

  // ── Execute sync ──

  async function handleSync() {
    setError(null);
    setStep("executing");
    try {
      // Build CellSelections from selections map
      const cellSelections: CellSelection[] = [];

      for (const [key, source] of Object.entries(selections)) {
        if (source === "keep") continue;
        const parts = key.split(":");
        const colType = parts[0];
        const field = parts.slice(1).join(":");
        const isCustom = source === "custom";
        const internalField = colType === "internal"
          ? field
          : mappings.find((e) => e.system === (colType as ExternalSystem) && e.externalField === field)?.internalField;
        const customValue = isCustom && internalField ? (customValues[internalField] ?? "") : undefined;

        if (colType === "internal") {
          // Internal column pulling from an external source
          if (isCustom) {
            const edge = mappings.find((e) => e.internalField === field);
            if (edge) {
              cellSelections.push({
                system: edge.system,
                externalField: edge.externalField,
                source: "custom",
                isInternalColumn: true,
                customValue,
                internalField: field,
              });
            }
          } else {
            // Need to find the edge for this internal field on the source system
            const sourceSystem = source as ExternalSystem;
            const sourceEdge = mappings.find(
              (e) => e.system === sourceSystem && e.internalField === field,
            );
            if (sourceEdge) {
              cellSelections.push({
                system: sourceSystem,
                externalField: sourceEdge.externalField,
                source: sourceSystem,
                isInternalColumn: true,
                internalField: field,
              });
            }
          }
        } else {
          // External column
          const system = colType as ExternalSystem;
          const edge = mappings.find((e) => e.system === system && e.externalField === field);
          if (edge) {
            cellSelections.push({
              system,
              externalField: field,
              source,
              customValue,
              internalField: edge.internalField,
            });
          }
        }
      }

      // Also add create operations for unlinked systems
      for (const sys of EXTERNAL_SYSTEMS) {
        if (linkedSystems[sys]) continue;
        if (!createToggles[sys]) continue;
        // All fields for this system should be pushed
        for (const edge of mappings) {
          if (edge.system !== sys) continue;
          if (edge.direction === "push-only") continue;
          cellSelections.push({
            system: sys,
            externalField: edge.externalField,
            source: "internal",
          });
        }
      }

      const intents = selectionToIntents(cellSelections, mappings);

      // 1. POST /plan
      const planRes = await fetch(
        `/api/inventory/products/${internalProductId}/sync/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intents }),
        },
      );
      if (!planRes.ok) {
        const err = await planRes.json();
        setError(err.error ?? "Failed to derive plan");
        setStep("table");
        return;
      }
      const planData: { plan: SyncPlan } = await planRes.json();
      const plan = planData.plan;

      if (plan.conflicts.length > 0) {
        setError(
          `Pull conflict: ${plan.conflicts.map((c) => c.internalField).join(", ")} — please resolve conflicting sources.`,
        );
        setStep("table");
        return;
      }

      // 2. POST /confirm
      const confirmRes = await fetch(
        `/api/inventory/products/${internalProductId}/sync/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planHash: plan.planHash }),
        },
      );
      if (!confirmRes.ok) {
        setError("Failed to get confirmation token");
        setStep("table");
        return;
      }
      const { token, issuedAt } = await confirmRes.json();

      // 3. POST /sync
      const execRes = await fetch(
        `/api/inventory/products/${internalProductId}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planHash: plan.planHash, token, issuedAt, intents }),
        },
      );
      const result = await execRes.json();

      if (execRes.status === 409) {
        setError("External state changed. Please retry.");
        setStep("table");
        return;
      }
      if (!execRes.ok) {
        setError(result.error ?? "Sync failed");
        setStep("table");
        return;
      }

      setOutcomes(result.outcomes);
      setStep("results");
      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setStep("table");
    }
  }

  // ── Summary bar counts ──
  const { fields: changeCount, systems: changeSystems } = useMemo(
    () => countChanges(selections),
    [selections],
  );
  const implicitWrites = useMemo(
    () => getImplicitWrites(mappings, selections, linkedSystems),
    [mappings, selections, linkedSystems],
  );

  // ── Render ──

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Sync: {skuName}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <span>{error}</span>
            {step === "table" && (
              <button
                onClick={handleRetry}
                className="ml-3 shrink-0 rounded bg-red-500/20 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Loading */}
        {step === "loading" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        )}

        {/* Table */}
        {step === "table" && (
          <div className="space-y-4">
            {/* Table container with horizontal scroll */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-surface-elevated">
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 min-w-[130px] bg-surface-elevated px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap">
                      Field
                    </th>
                    <th className="min-w-[120px] px-3 py-2 text-left text-xs font-medium text-muted border-t-2 border-emerald-500 bg-emerald-500/10">
                      Internal
                    </th>
                    {orderedSystems.map((sys) => (
                      <th
                        key={sys}
                        className={`border-l border-border px-3 py-2 text-left text-xs font-medium text-muted align-top border-t-2 ${
                          sys === "hubspot"
                            ? "border-orange-500 bg-orange-500/10"
                            : sys === "zoho"
                              ? "border-red-500 bg-red-500/10"
                              : "border-purple-500 bg-purple-500/10"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{SYSTEM_SHORT[sys]}</span>
                          {linkedSystems[sys] && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" title="Linked" />
                          )}
                        </div>
                        {!linkedSystems[sys] && (
                          <ProductSearchDropdown
                            system={sys}
                            onLink={(externalId) => handleLinkProduct(sys, externalId)}
                            onCreateNew={() => handleCreateToggle(sys)}
                            isCreateChecked={createToggles[sys]}
                            isLinking={linkingSystem === sys}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Needs Attention section */}
                  {attention.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={2 + orderedSystems.length}
                          className="sticky left-0 bg-surface-elevated px-3 pt-3 pb-1 text-xs font-semibold text-yellow-400"
                        >
                          Needs Attention ({attention.length})
                        </td>
                      </tr>
                      {attention.map((row) => (
                        <FieldRowComponent
                          key={row.internalField}
                          row={row}
                          snapshots={snapshots}
                          mappings={mappings}
                          linkedSystems={linkedSystems}
                          orderedSystems={orderedSystems}
                          createToggles={createToggles}
                          selections={selections}
                          customValues={customValues}
                          lockedPullSources={lockedPullSources}
                          onSelectionChange={handleSelectionChange}
                          onCustomValueChange={handleCustomValueChange}
                          onCustomCancel={handleCustomCancel}
                          readOnly={false}
                        />
                      ))}
                    </>
                  )}

                  {/* In Sync section */}
                  {inSync.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={2 + orderedSystems.length} className="sticky left-0 bg-surface-elevated px-3 pt-4 pb-1">
                          <button
                            onClick={() => setShowInSync(!showInSync)}
                            className="text-xs font-medium text-muted hover:text-foreground"
                          >
                            {showInSync ? "Hide" : "Show"} {inSync.length} in-sync field{inSync.length !== 1 ? "s" : ""}
                            <span className="ml-1">{showInSync ? "\u25B2" : "\u25BC"}</span>
                          </button>
                        </td>
                      </tr>
                      {showInSync &&
                        inSync.map((row) => (
                          <FieldRowComponent
                            key={row.internalField}
                            row={row}
                            snapshots={snapshots}
                            mappings={mappings}
                            linkedSystems={linkedSystems}
                            orderedSystems={orderedSystems}
                            createToggles={createToggles}
                            selections={selections}
                            customValues={customValues}
                            lockedPullSources={lockedPullSources}
                            onSelectionChange={handleSelectionChange}
                            onCustomValueChange={handleCustomValueChange}
                            onCustomCancel={handleCustomCancel}
                            readOnly={true}
                          />
                        ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* Implicit writes */}
            {implicitWrites.length > 0 && (
              <p className="text-xs text-muted">
                Also updates: {implicitWrites.join(", ")}
              </p>
            )}

            {/* Summary bar */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-muted">
                {changeCount === 0
                  ? "No changes selected"
                  : `${changeCount} field${changeCount !== 1 ? "s" : ""} will be updated across ${changeSystems.size} system${changeSystems.size !== 1 ? "s" : ""}`}
              </span>
              <button
                onClick={handleSync}
                disabled={changeCount === 0}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Sync
              </button>
            </div>
          </div>
        )}

        {/* Executing */}
        {step === "executing" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              <p className="text-sm text-muted">Syncing across systems...</p>
            </div>
          </div>
        )}

        {/* Results */}
        {step === "results" && (
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Sync Results</h3>
            {outcomes.map((outcome, i) => (
              <div
                key={i}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  outcome.status === "success"
                    ? "border-green-500/30 bg-green-500/5 text-green-400"
                    : outcome.status === "failed"
                      ? "border-red-500/30 bg-red-500/5 text-red-400"
                      : "border-border bg-surface-2 text-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {outcome.system === "internal"
                      ? "Internal Product"
                      : SYSTEM_LABELS[outcome.system as ExternalSystem]}
                  </span>
                  <span className="text-xs uppercase">{outcome.status}</span>
                </div>
                <p className="mt-1 text-xs">{outcome.message}</p>
                {outcome.fieldDetails.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {outcome.fieldDetails.map((fd) => (
                      <span
                        key={fd.externalField}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          fd.source === "cascade"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-surface-2 text-muted"
                        }`}
                      >
                        {fd.externalField}
                        {fd.source === "cascade" && " (cascaded)"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field Row Component ──

interface FieldRowComponentProps {
  row: FieldRow;
  snapshots: FieldValueSnapshot[];
  mappings: FieldMappingEdge[];
  linkedSystems: Record<ExternalSystem, boolean>;
  orderedSystems: ExternalSystem[];
  createToggles: Record<ExternalSystem, boolean>;
  selections: SelectionMap;
  customValues: Record<string, string>;
  lockedPullSources: Record<string, ExternalSystem | null>;
  onSelectionChange: (key: string, value: "keep" | "internal" | ExternalSystem | "custom") => void;
  onCustomValueChange: (fieldKey: string, value: string) => void;
  onCustomCancel: (fieldKey: string) => void;
  readOnly: boolean;
}

function FieldRowComponent({
  row,
  snapshots,
  mappings,
  linkedSystems,
  orderedSystems,
  createToggles,
  selections,
  customValues,
  lockedPullSources,
  onSelectionChange,
  onCustomValueChange,
  onCustomCancel,
  readOnly,
}: FieldRowComponentProps) {
  const internalValue = getSnapshotValue(snapshots, "internal", row.internalField);

  // For the internal column, determine the dropdown option for pulling
  const internalKey = `internal:${row.internalField}`;
  const internalSelection = selections[internalKey] ?? "keep";
  const rowCustomValue = customValues[row.internalField] ?? "";

  return (
    <tr className="border-b border-border/30">
      {/* Field label */}
      <td className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground whitespace-nowrap">
        {row.label}
        {row.isPushOnly && (
          <span className="ml-1 text-xs text-muted">(push-only)</span>
        )}
      </td>

      {/* Internal column */}
      <td className="px-3 py-2 bg-emerald-500/10">
        {row.isPushOnly ? (
          <span className="font-mono text-xs text-muted">{formatValue(internalValue)}</span>
        ) : readOnly ? (
          <span className="font-mono text-xs text-muted">{formatValue(internalValue)}</span>
        ) : (
          <InternalCell
            row={row}
            snapshots={snapshots}
            mappings={mappings}
            linkedSystems={linkedSystems}
            customValue={rowCustomValue}
            selection={internalSelection}
            onSelectionChange={(val) => onSelectionChange(internalKey, val)}
            onCustomValueChange={(val) => onCustomValueChange(row.internalField, val)}
            onCustomCancel={() => onCustomCancel(row.internalField)}
            internalValue={internalValue}
          />
        )}
      </td>

      {/* External system columns */}
      {orderedSystems.map((sys) => {
        const systemBg =
          sys === "hubspot"
            ? "bg-orange-500/10"
            : sys === "zoho"
              ? "bg-red-500/10"
              : "bg-purple-500/10";
        const edge = row.edges.find((e) => e.system === sys);
        if (!edge) {
          return (
            <td key={sys} className={`border-l border-border px-3 py-2 text-xs text-muted ${systemBg}`}>
            </td>
          );
        }

        const linked = linkedSystems[sys];
        const extValue = getSnapshotValue(snapshots, sys, edge.externalField);

        if (!linked && !createToggles[sys]) {
          return (
            <td key={sys} className={`border-l border-border px-3 py-2 text-xs text-muted/40 ${systemBg}`}>
            </td>
          );
        }

        if (row.isPushOnly) {
          return (
            <td key={sys} className={`border-l border-border px-3 py-2 ${systemBg}`}>
              <span className="font-mono text-xs text-muted">
                {linked ? formatValue(extValue) : "\u2014"}
              </span>
            </td>
          );
        }

        if (readOnly) {
          return (
            <td key={sys} className={`border-l border-border px-3 py-2 ${systemBg}`}>
              <span className="font-mono text-xs text-muted">
                {linked ? formatValue(extValue) : "\u2014"}
              </span>
            </td>
          );
        }

        const selKey = `${sys}:${edge.externalField}`;
        const cellSelection = selections[selKey] ?? "keep";
        const lockedSource = lockedPullSources[row.internalField] ?? null;

        return (
          <td key={sys} className={`border-l border-border px-3 py-2 ${systemBg}`}>
            <ExternalCell
              system={sys}
              edge={edge}
              internalField={row.internalField}
              snapshots={snapshots}
              mappings={mappings}
              linkedSystems={linkedSystems}
              selection={cellSelection}
              customValue={rowCustomValue}
              lockedPullSource={lockedSource}
              onSelectionChange={(val) => onSelectionChange(selKey, val)}
              onCustomValueChange={(val) => onCustomValueChange(row.internalField, val)}
              onCustomCancel={() => onCustomCancel(row.internalField)}
              extValue={extValue}
            />
          </td>
        );
      })}
    </tr>
  );
}

// ── Internal Cell ──

interface InternalCellProps {
  row: FieldRow;
  snapshots: FieldValueSnapshot[];
  mappings: FieldMappingEdge[];
  linkedSystems: Record<ExternalSystem, boolean>;
  customValue: string;
  selection: "keep" | "internal" | ExternalSystem | "custom";
  onSelectionChange: (val: "keep" | "internal" | ExternalSystem | "custom") => void;
  onCustomValueChange: (val: string) => void;
  onCustomCancel: () => void;
  internalValue: string | number | null;
}

function InternalCell({
  row,
  snapshots,
  mappings: _mappings,
  linkedSystems,
  customValue,
  selection,
  onSelectionChange,
  onCustomValueChange,
  onCustomCancel,
  internalValue,
}: InternalCellProps) {
  // Build options for the internal column: Keep + external sources only
  const options: DropdownOption[] = useMemo(() => {
    const opts: DropdownOption[] = [
      { value: "keep", label: "Keep", projectedValue: internalValue },
    ];

    for (const sys of EXTERNAL_SYSTEMS) {
      if (!linkedSystems[sys]) continue;
      const edge = row.edges.find((e) => e.system === sys);
      if (!edge) continue;
      if (edge.direction === "push-only") continue;

      const extVal = getSnapshotValue(snapshots, sys, edge.externalField);
      opts.push({
        value: sys,
        label: SYSTEM_SHORT[sys],
        projectedValue: extVal,
        disabled: String(extVal ?? "") === String(internalValue ?? ""),
      });
    }

    if (customValue) {
      opts.push({
        value: "custom",
        label: "Custom",
        projectedValue: customValue,
      });
    }

    return opts;
  }, [row.edges, snapshots, linkedSystems, internalValue, customValue]);

  const projected =
    selection !== "keep"
      ? options.find((o) => o.value === selection)?.projectedValue ?? null
      : null;

  const showTransition = selection !== "keep" && projected !== null;

  return (
    <div className="space-y-1">
      {showTransition ? (
        <div className="flex items-center gap-1 text-xs">
          <span className="font-mono text-muted line-through">
            {formatValue(internalValue)}
          </span>
          <span className="text-green-400">&rarr;</span>
          <span className="rounded bg-green-500/10 px-1 py-0.5 font-mono font-medium text-green-400">
            {formatValue(projected)}
          </span>
        </div>
      ) : (
        <span className="font-mono text-xs text-foreground">
          {formatValue(internalValue)}
        </span>
      )}
      {selection === "custom" ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={customValue}
            onChange={(e) => onCustomValueChange(e.target.value)}
            onBlur={() => {
              if (!customValue.trim()) onCustomCancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !customValue.trim()) {
                onCustomCancel();
              }
            }}
            className="w-full rounded border border-green-500/50 bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="Enter custom value"
          />
          <button
            type="button"
            onClick={onCustomCancel}
            className="rounded border border-t-border px-2 py-1 text-xs text-muted hover:text-foreground"
            title="Cancel custom value"
          >
            &times;
          </button>
        </div>
      ) : (
        <select
          value={selection}
          aria-label={`Source for ${row.label}`}
          onChange={(e) =>
            onSelectionChange(e.target.value as "keep" | ExternalSystem | "custom")
          }
          className={`w-full rounded border px-1.5 py-0.5 text-xs bg-surface-2 text-foreground ${
            selection !== "keep"
              ? "border-green-500/50"
              : "border-border"
          }`}
        >
          {options.map((opt) => {
            const display = formatValue(opt.projectedValue);
            const label = truncate(display, 30);
            const suffix = opt.value === "keep"
              ? "(current)"
              : `(${opt.label})`;
            return (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {label} {suffix}{opt.disabled ? " (same)" : ""}
              </option>
            );
          })}
          <option value="custom">Custom...</option>
        </select>
      )}
    </div>
  );
}

// ── External Cell ──

interface ExternalCellProps {
  system: ExternalSystem;
  edge: FieldMappingEdge;
  internalField: string;
  snapshots: FieldValueSnapshot[];
  mappings: FieldMappingEdge[];
  linkedSystems: Record<ExternalSystem, boolean>;
  customValue: string;
  selection: "keep" | "internal" | ExternalSystem | "custom";
  lockedPullSource: ExternalSystem | null;
  onSelectionChange: (val: "keep" | "internal" | ExternalSystem | "custom") => void;
  onCustomValueChange: (val: string) => void;
  onCustomCancel: () => void;
  extValue: string | number | null;
}

function ExternalCell({
  system,
  edge,
  internalField,
  snapshots,
  mappings,
  linkedSystems,
  customValue,
  selection,
  lockedPullSource,
  onSelectionChange,
  onCustomValueChange,
  onCustomCancel,
  extValue,
}: ExternalCellProps) {
  const options = useMemo(
    () =>
      getDropdownOptions(
        system,
        edge.externalField,
        internalField,
        mappings,
        snapshots,
        linkedSystems,
        lockedPullSource,
      ),
    [system, edge.externalField, internalField, mappings, snapshots, linkedSystems, lockedPullSource],
  );

  const projected =
    selection !== "keep"
      ? getProjectedValue(
          selection,
          internalField,
          edge.externalField,
          system,
          snapshots,
          mappings,
          customValue,
        )
      : null;

  const showTransition = selection !== "keep";

  // Detect divergence: if after this operation, the value will differ from other systems
  // This is informational (yellow border), not blocking
  const isDiverging =
    selection === "keep" &&
    String(extValue ?? "") !==
      String(getSnapshotValue(snapshots, "internal", internalField) ?? "");

  return (
    <div className="space-y-1">
      {showTransition ? (
        <div className="flex items-center gap-1 text-xs">
          <span className="font-mono text-muted line-through">
            {formatValue(extValue)}
          </span>
          <span className="text-blue-400">&rarr;</span>
          <span className="rounded bg-blue-500/10 px-1 py-0.5 font-mono font-medium text-blue-400">
            {formatValue(projected)}
          </span>
        </div>
      ) : (
        <span className="font-mono text-xs text-foreground">
          {formatValue(extValue)}
        </span>
      )}
      {selection === "custom" ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={customValue}
            onChange={(e) => onCustomValueChange(e.target.value)}
            onBlur={() => {
              if (!customValue.trim()) onCustomCancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !customValue.trim()) {
                onCustomCancel();
              }
            }}
            className="w-full rounded border border-blue-500/50 bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="Enter custom value"
          />
          <button
            type="button"
            onClick={onCustomCancel}
            className="rounded border border-t-border px-2 py-1 text-xs text-muted hover:text-foreground"
            title="Cancel custom value"
          >
            &times;
          </button>
        </div>
      ) : (
        <select
          value={selection}
          aria-label={`${SYSTEM_LABELS[system]} source for ${FIELD_LABELS[internalField] ?? internalField}`}
          onChange={(e) =>
            onSelectionChange(e.target.value as "keep" | "internal" | ExternalSystem | "custom")
          }
          className={`w-full rounded border px-1.5 py-0.5 text-xs bg-surface-2 text-foreground ${
            selection !== "keep"
              ? "border-blue-500/50"
              : isDiverging
                ? "border-yellow-500/40"
                : "border-border"
          }`}
        >
          {options.map((opt) => {
            const display = formatValue(opt.projectedValue);
            const label = truncate(display, 30);
            const suffix = opt.value === "keep"
              ? "(current)"
              : `(${opt.label})`;
            return (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {label} {suffix}{opt.disabled ? " (same)" : ""}
              </option>
            );
          })}
          <option value="custom">Custom...</option>
        </select>
      )}
    </div>
  );
}

// ── Product Search Dropdown (for linking unlinked systems) ──

interface ProductSearchDropdownProps {
  system: ExternalSystem;
  onLink: (externalId: string) => void;
  onCreateNew: () => void;
  isCreateChecked: boolean;
  isLinking: boolean;
}

function ProductSearchDropdown({
  system,
  onLink,
  onCreateNew,
  isCreateChecked,
  isLinking,
}: ProductSearchDropdownProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/products/cache?source=${encodeURIComponent(system)}&search=${encodeURIComponent(query)}&limit=10`,
        );
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.products ?? []);
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, system]);

  function handleSelect(product: CachedProduct) {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    onLink(product.externalId);
  }

  function handleCreateNewClick() {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    if (!isCreateChecked) {
      onCreateNew();
    }
  }

  if (isLinking) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <div className="h-3 w-3 animate-spin rounded-full border border-orange-500 border-t-transparent" />
        <span>Linking...</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative mt-1.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (query.length >= 2 && results.length > 0) setShowDropdown(true);
          }}
          placeholder={`Search ${SYSTEM_SHORT[system]}...`}
          className="w-full min-w-[100px] rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted/50 focus:border-orange-500/50 focus:outline-none"
        />
        {isSearching && (
          <div className="h-3 w-3 shrink-0 animate-spin rounded-full border border-orange-500 border-t-transparent" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-xl">
          {results.map((product) => (
            <button
              key={product.externalId}
              type="button"
              onClick={() => handleSelect(product)}
              className="flex w-full flex-col gap-0.5 border-b border-border/30 px-3 py-2 text-left text-xs hover:bg-surface-2 last:border-b-0"
            >
              <span className="font-medium text-foreground">{truncate(product.name, 50)}</span>
              {product.sku && (
                <span className="text-muted">SKU: {truncate(product.sku, 30)}</span>
              )}
              <span className="text-muted/60">ID: {product.externalId}</span>
            </button>
          ))}
          {results.length === 0 && query.length >= 2 && !isSearching && (
            <div className="px-3 py-2 text-xs text-muted">No matches found</div>
          )}
          {/* Create new option — always visible */}
          <button
            type="button"
            onClick={handleCreateNewClick}
            className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs font-medium text-orange-400 hover:bg-surface-2"
          >
            <span className="text-base leading-none">+</span>
            <span>Create new in {SYSTEM_SHORT[system]}</span>
          </button>
        </div>
      )}

      {/* Always-visible create option */}
      {isCreateChecked ? (
        <label className="mt-1 inline-flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked
            onChange={onCreateNew}
            className="rounded"
          />
          <span className="text-muted">Create new</span>
        </label>
      ) : (
        <button
          type="button"
          onClick={handleCreateNewClick}
          className="mt-1 text-xs font-medium text-orange-400 hover:text-orange-300"
        >
          + Create new in {SYSTEM_SHORT[system]}
        </button>
      )}
    </div>
  );
}
