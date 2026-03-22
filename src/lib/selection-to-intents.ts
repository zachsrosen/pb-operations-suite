// src/lib/selection-to-intents.ts
//
// Translates per-cell dropdown selections from the SyncModal wide table
// into the IntentsMap consumed by the existing sync relay backend.

import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
} from "./catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "./catalog-sync-types";
import { normalizedEqual } from "./catalog-sync-mappings";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;

// ── Public types ──

/** A single cell's dropdown selection */
export interface CellSelection {
  /** The external system this cell belongs to */
  system: ExternalSystem;
  /** The external field name (mapping edge key) */
  externalField: string;
  /** Which source the user picked: "keep", "internal", or an ExternalSystem */
  source: "keep" | "internal" | ExternalSystem;
  /** True when this selection is for the Internal column (controls updateInternalOnPull) */
  isInternalColumn?: boolean;
}

/** A row in the comparison table */
export interface FieldRow {
  internalField: string;
  label: string;
  unit?: string;
  isPushOnly: boolean;
  edges: FieldMappingEdge[];
}

/** Dropdown option */
export interface DropdownOption {
  value: "keep" | "internal" | ExternalSystem;
  label: string;
  projectedValue: string | number | null;
  disabled?: boolean;
}

// ── Core translation ──

/**
 * Convert per-cell dropdown selections into an IntentsMap for the backend.
 *
 * Rules:
 * - "keep" → no entry (skip is default)
 * - "internal" in an external column → push
 * - External source in the Internal column → pull with updateInternalOnPull: true
 * - External source in another external column → relay: pull(source) + push(target)
 * - Dedup: same system+externalField merges; updateInternalOnPull: true wins
 */
export function selectionToIntents(
  selections: CellSelection[],
  mappings: FieldMappingEdge[],
): IntentsMap {
  const result: IntentsMap = { zoho: {}, hubspot: {}, zuper: {} };

  // Expand companion fields before processing
  const expanded = expandCompanions(selections, mappings);

  for (const sel of expanded) {
    if (sel.source === "keep") continue;

    if (sel.source === "internal") {
      // Push internal value to this external system
      result[sel.system][sel.externalField] = {
        direction: "push",
        mode: "manual",
        updateInternalOnPull: false,
      };
      continue;
    }

    // Source is an external system
    const sourceSystem = sel.source as ExternalSystem;

    if (sel.isInternalColumn) {
      // Internal column pulling from an external source
      const sourceEdge = findEdgeForInternalField(mappings, sourceSystem, sel);
      if (sourceEdge) {
        mergePull(result, sourceSystem, sourceEdge.externalField, true);
      }
    } else {
      // External column picking another external source → relay
      // 1. Pull from the source system (no internal persist)
      const sourceEdge = findEdgeForInternalField(mappings, sourceSystem, sel);
      if (sourceEdge) {
        mergePull(result, sourceSystem, sourceEdge.externalField, false);
      }
      // 2. Push to the target system
      result[sel.system][sel.externalField] = {
        direction: "push",
        mode: "manual",
        updateInternalOnPull: false,
      };
    }
  }

  return result;
}

/** Find the mapping edge on `sourceSystem` that shares the same internalField as `sel` */
function findEdgeForInternalField(
  mappings: FieldMappingEdge[],
  sourceSystem: ExternalSystem,
  sel: CellSelection,
): FieldMappingEdge | undefined {
  // Find what internalField the target edge maps to
  const targetEdge = mappings.find(
    (e) => e.system === sel.system && e.externalField === sel.externalField,
  );
  if (!targetEdge) return undefined;

  // Find the source system's edge for the same internalField
  return mappings.find(
    (e) => e.system === sourceSystem && e.internalField === targetEdge.internalField,
  );
}

/**
 * Expand companion fields: if an edge has a `companion` property,
 * emit a matching selection for the companion field on the same system.
 * This ensures vendor_name and vendor_id always move together.
 */
export function expandCompanions(
  selections: CellSelection[],
  mappings: FieldMappingEdge[],
): CellSelection[] {
  const expanded = [...selections];
  for (const sel of selections) {
    if (sel.source === "keep") continue;
    const matchedEdge = mappings.find(
      (e) => e.system === sel.system && e.externalField === sel.externalField,
    );
    if (!matchedEdge?.companion) continue;
    // Check if the companion is already in selections
    const hasCompanion = selections.some(
      (s) => s.system === sel.system && s.externalField === matchedEdge.companion,
    );
    if (!hasCompanion) {
      expanded.push({
        system: sel.system,
        externalField: matchedEdge.companion,
        source: sel.source,
        isInternalColumn: sel.isInternalColumn,
      });
    }
  }
  return expanded;
}

/** Merge a pull intent, with updateInternalOnPull: true winning over false */
function mergePull(
  result: IntentsMap,
  system: ExternalSystem,
  externalField: string,
  updateInternal: boolean,
): void {
  const existing = result[system][externalField];
  if (existing && existing.direction === "pull") {
    // true wins over false
    if (updateInternal) {
      existing.updateInternalOnPull = true;
    }
    return;
  }
  result[system][externalField] = {
    direction: "pull",
    mode: "manual",
    updateInternalOnPull: updateInternal,
  };
}

// ── Smart defaults ──

/**
 * Compute default dropdown selections based on value comparison.
 *
 * Rules (from spec):
 * - All systems agree → "keep"
 * - Internal has value, external empty → "internal" (obvious push)
 * - Internal empty, external has value → "keep" (user must opt in)
 * - Values differ → "keep" (user decides)
 */
export function computeSmartDefaults(
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  linkedSystems: Record<ExternalSystem, boolean>,
): CellSelection[] {
  const defaults: CellSelection[] = [];

  for (const edgeItem of mappings) {
    if (!linkedSystems[edgeItem.system]) continue;

    if (edgeItem.direction === "push-only") continue;

    const internalSnap = snapshots.find(
      (s) => s.system === "internal" && s.field === edgeItem.internalField,
    );
    const externalSnap = snapshots.find(
      (s) => s.system === edgeItem.system && s.field === edgeItem.externalField,
    );

    const internalValue = internalSnap?.rawValue ?? null;
    const externalValue = externalSnap?.rawValue ?? null;

    let source: "keep" | "internal" = "keep";

    if (normalizedEqual(internalValue, externalValue, edgeItem.normalizeWith)) {
      source = "keep"; // already in sync
    } else if (internalValue != null && (externalValue == null || externalValue === "")) {
      source = "internal"; // obvious push
    }
    // else: values differ or internal empty → keep (user decides)

    defaults.push({
      system: edgeItem.system,
      externalField: edgeItem.externalField,
      source,
    });
  }

  return defaults;
}

// ── Dropdown option builder ──

/**
 * Build the dropdown options for a cell, filtering by:
 * - Whether the system is linked
 * - Whether the source value matches the current value (greyed/hidden)
 * - Whether the source would conflict with the Internal column's pull
 */
export function getDropdownOptions(
  system: ExternalSystem,
  externalField: string,
  internalField: string,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  linkedSystems: Record<ExternalSystem, boolean>,
  lockedPullSource: ExternalSystem | null,
): DropdownOption[] {
  const options: DropdownOption[] = [];

  const currentValue = snapshots.find(
    (s) => s.system === system && s.field === externalField,
  )?.rawValue ?? null;

  // Always include Keep
  options.push({
    value: "keep",
    label: "Keep",
    projectedValue: currentValue,
  });

  const internalValue = snapshots.find(
    (s) => s.system === "internal" && s.field === internalField,
  )?.rawValue ?? null;

  // Internal as a source
  options.push({
    value: "internal",
    label: "Internal",
    projectedValue: internalValue,
    disabled: internalValue === currentValue,
  });

  // Other external systems as sources (relay)
  for (const otherSys of EXTERNAL_SYSTEMS) {
    if (otherSys === system) continue; // can't be your own source
    if (!linkedSystems[otherSys]) continue; // not linked

    // Conflict check: if Internal column locked a pull source,
    // external cells can only use "keep", "internal", or the same source
    if (lockedPullSource && otherSys !== lockedPullSource) continue;

    const otherEdge = mappings.find(
      (e) => e.system === otherSys && e.internalField === internalField,
    );
    if (!otherEdge) continue;

    const otherValue = snapshots.find(
      (s) => s.system === otherSys && s.field === otherEdge.externalField,
    )?.rawValue ?? null;

    options.push({
      value: otherSys,
      label: otherSys === "zoho" ? "Zoho" : otherSys === "hubspot" ? "HubSpot" : "Zuper",
      projectedValue: otherValue,
      disabled: otherValue === currentValue,
    });
  }

  return options;
}

/** Format a snapshot value for display in dropdown labels. */
