// src/components/catalog/SyncModal.tsx
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
import { isVirtualField, normalizedEqual } from "@/lib/catalog-sync-mappings";

// ── Types ──

type Step = "loading" | "table" | "executing" | "results";

/** Per-cell selection keyed by `${system}:${externalField}` for external columns
 *  or `internal:${internalField}` for the internal column. */
type SelectionMap = Record<string, "keep" | "internal" | ExternalSystem>;

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
  _name: "Name",
  _specification: "Specification",
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
    const isVirtual = isVirtualField(internalField);
    const isPushOnly = edges.every((e) => e.direction === "push-only");

    const label = FIELD_LABELS[internalField] ?? internalField;

    const row: FieldRow = {
      internalField,
      label,
      isVirtual,
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
  source: "keep" | "internal" | ExternalSystem,
  internalField: string,
  externalField: string,
  system: ExternalSystem,
  snapshots: FieldValueSnapshot[],
  mappings: FieldMappingEdge[],
): string | number | null {
  if (source === "keep") {
    return getSnapshotValue(snapshots, system, externalField);
  }
  if (source === "internal") {
    return getSnapshotValue(snapshots, "internal", internalField);
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

  // Virtual/generator fields are now visible in the table with checkboxes,
  // so they are no longer listed as implicit writes.

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
  const [createToggles, setCreateToggles] = useState<Record<ExternalSystem, boolean>>({
    zoho: false,
    hubspot: false,
    zuper: false,
  });
  const [showInSync, setShowInSync] = useState(false);
  const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);

  // ── Linked systems ──
  const linkedSystems = useMemo<Record<ExternalSystem, boolean>>(() => {
    const result = { zoho: false, hubspot: false, zuper: false };
    for (const sys of EXTERNAL_SYSTEMS) {
      result[sys] = snapshots.some((s) => s.system === sys);
    }
    return result;
  }, [snapshots]);

  // ── Reset when modal opens ──
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    setStep("loading");
    setError(null);
    setOutcomes([]);
    setSelections({});
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
      if (value === "keep" || value === "internal") continue;
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
    (key: string, value: "keep" | "internal" | ExternalSystem) => {
      setSelections((prev) => {
        const next = { ...prev, [key]: value };

        // Conflict prevention: if this is the Internal column changing,
        // reset any external cells for the same field that would conflict
        if (key.startsWith("internal:")) {
          const internalField = key.split(":")[1];
          if (value !== "keep" && value !== "internal") {
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
                  extSel !== value
                ) {
                  // Conflicting source — reset to keep
                  next[extKey] = "keep";
                }
              }
            }
          }
        }

        return next;
      });
    },
    [mappings],
  );

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
            if (isVirtualField(edge.internalField)) continue;
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

        if (colType === "internal") {
          // Internal column pulling from an external source
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
            });
          }
        } else {
          // External column
          const system = colType as ExternalSystem;
          cellSelections.push({
            system,
            externalField: field,
            source,
          });
        }
      }

      // Also add create operations for unlinked systems
      for (const sys of EXTERNAL_SYSTEMS) {
        if (linkedSystems[sys]) continue;
        if (!createToggles[sys]) continue;
        // All fields for this system should be pushed
        for (const edge of mappings) {
          if (edge.system !== sys) continue;
          if (isVirtualField(edge.internalField)) continue;
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
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 min-w-[130px] bg-surface-elevated px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap">
                      Field
                    </th>
                    <th className="min-w-[120px] px-3 py-2 text-left text-xs font-medium text-muted">
                      Internal
                    </th>
                    {EXTERNAL_SYSTEMS.map((sys) => (
                      <th key={sys} className="border-l border-border px-3 py-2 text-left text-xs font-medium text-muted">
                        <div className="flex items-center gap-2">
                          <span>{SYSTEM_SHORT[sys]}</span>
                          {!linkedSystems[sys] && (
                            <label className="inline-flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={createToggles[sys]}
                                onChange={() => handleCreateToggle(sys)}
                                className="rounded"
                              />
                              <span className="text-muted">Create</span>
                            </label>
                          )}
                        </div>
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
                          colSpan={2 + EXTERNAL_SYSTEMS.length}
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
                          createToggles={createToggles}
                          selections={selections}
                          lockedPullSources={lockedPullSources}
                          onSelectionChange={handleSelectionChange}
                          readOnly={false}
                        />
                      ))}
                    </>
                  )}

                  {/* In Sync section */}
                  {inSync.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={2 + EXTERNAL_SYSTEMS.length} className="sticky left-0 bg-surface-elevated px-3 pt-4 pb-1">
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
                            createToggles={createToggles}
                            selections={selections}
                            lockedPullSources={lockedPullSources}
                            onSelectionChange={handleSelectionChange}
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
  createToggles: Record<ExternalSystem, boolean>;
  selections: SelectionMap;
  lockedPullSources: Record<string, ExternalSystem | null>;
  onSelectionChange: (key: string, value: "keep" | "internal" | ExternalSystem) => void;
  readOnly: boolean;
}

function FieldRowComponent({
  row,
  snapshots,
  mappings,
  linkedSystems,
  createToggles,
  selections,
  lockedPullSources,
  onSelectionChange,
  readOnly,
}: FieldRowComponentProps) {
  const internalValue = getSnapshotValue(snapshots, "internal", row.internalField);

  // For the internal column, determine the dropdown option for pulling
  const internalKey = `internal:${row.internalField}`;
  const internalSelection = selections[internalKey] ?? "keep";

  return (
    <tr className="border-b border-border/30">
      {/* Field label */}
      <td className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground whitespace-nowrap">
        {row.label}
        {row.isVirtual && (
          <span className="ml-1 text-xs text-muted">(auto-generated)</span>
        )}
        {row.isPushOnly && !row.isVirtual && (
          <span className="ml-1 text-xs text-muted">(push-only)</span>
        )}
      </td>

      {/* Internal column */}
      <td className="px-3 py-2">
        {row.isVirtual ? (
          <span className="font-mono text-xs text-muted">{formatValue(internalValue)}</span>
        ) : row.isPushOnly ? (
          <span className="font-mono text-xs text-muted">{formatValue(internalValue)}</span>
        ) : readOnly ? (
          <span className="font-mono text-xs text-muted">{formatValue(internalValue)}</span>
        ) : (
          <InternalCell
            row={row}
            snapshots={snapshots}
            mappings={mappings}
            linkedSystems={linkedSystems}
            selection={internalSelection}
            onSelectionChange={(val) => onSelectionChange(internalKey, val)}
            internalValue={internalValue}
          />
        )}
      </td>

      {/* External system columns */}
      {EXTERNAL_SYSTEMS.map((sys) => {
        const edge = row.edges.find((e) => e.system === sys);
        if (!edge) {
          return (
            <td key={sys} className="border-l border-border px-3 py-2 text-xs text-muted">
            </td>
          );
        }

        const linked = linkedSystems[sys];
        const extValue = getSnapshotValue(snapshots, sys, edge.externalField);

        if (!linked && !createToggles[sys]) {
          return (
            <td key={sys} className="border-l border-border px-3 py-2 text-xs text-muted/40">
            </td>
          );
        }

        if (row.isVirtual) {
          const selKey = `${sys}:${edge.externalField}`;
          const isChecked = selections[selKey] === "internal";
          return (
            <td key={sys} className="border-l border-border px-3 py-2">
              <div className="space-y-1">
                <span className="font-mono text-xs text-muted" title={linked ? String(extValue ?? "") : ""}>
                  {linked ? truncate(formatValue(extValue), 20) : "\u2014"}
                </span>
                {linked && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        onSelectionChange(
                          selKey,
                          isChecked ? "keep" : "internal",
                        )
                      }
                      aria-label={`Update ${SYSTEM_LABELS[sys]} ${row.label}`}
                      className="rounded"
                    />
                    <span className={isChecked ? "text-blue-400" : "text-muted"}>
                      Update
                    </span>
                  </label>
                )}
              </div>
            </td>
          );
        }

        if (row.isPushOnly || readOnly) {
          return (
            <td key={sys} className="border-l border-border px-3 py-2">
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
          <td key={sys} className="border-l border-border px-3 py-2">
            <ExternalCell
              system={sys}
              edge={edge}
              internalField={row.internalField}
              snapshots={snapshots}
              mappings={mappings}
              linkedSystems={linkedSystems}
              selection={cellSelection}
              lockedPullSource={lockedSource}
              onSelectionChange={(val) => onSelectionChange(selKey, val)}
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
  selection: "keep" | "internal" | ExternalSystem;
  onSelectionChange: (val: "keep" | "internal" | ExternalSystem) => void;
  internalValue: string | number | null;
}

function InternalCell({
  row,
  snapshots,
  mappings: _mappings,
  linkedSystems,
  selection,
  onSelectionChange,
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

    return opts;
  }, [row.edges, snapshots, linkedSystems, internalValue]);

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
      <select
        value={selection}
        aria-label={`Source for ${row.label}`}
        onChange={(e) =>
          onSelectionChange(e.target.value as "keep" | ExternalSystem)
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
      </select>
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
  selection: "keep" | "internal" | ExternalSystem;
  lockedPullSource: ExternalSystem | null;
  onSelectionChange: (val: "keep" | "internal" | ExternalSystem) => void;
  extValue: string | number | null;
}

function ExternalCell({
  system,
  edge,
  internalField,
  snapshots,
  mappings,
  linkedSystems,
  selection,
  lockedPullSource,
  onSelectionChange,
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
      <select
        value={selection}
        aria-label={`${SYSTEM_LABELS[system]} source for ${FIELD_LABELS[internalField] ?? internalField}`}
        onChange={(e) =>
          onSelectionChange(e.target.value as "keep" | "internal" | ExternalSystem)
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
      </select>
    </div>
  );
}
