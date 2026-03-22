// src/lib/catalog-sync-types.ts

// ── External system identifiers ──

export type ExternalSystem = "zoho" | "hubspot" | "zuper";

export const EXTERNAL_SYSTEMS: ExternalSystem[] = ["zoho", "hubspot", "zuper"];

// ── System precedence for equal-normalized multi-pull winner ──
// When multiple pulls normalize equal but differ in raw formatting,
// the first system in this order wins the raw write value.
export const SYSTEM_PRECEDENCE: ExternalSystem[] = ["zoho", "hubspot", "zuper"];

// ── Field intent (user's per-field decision) ──

export type Direction = "push" | "pull" | "skip";
export type SelectionMode = "manual" | "auto";

export interface FieldIntent {
  direction: Direction;
  mode: SelectionMode;
  /** Only meaningful when direction === "pull". Controls whether the
   *  pulled value writes to the internal product DB record. */
  updateInternalOnPull: boolean;
}

// ── Normalization ──

export type NormalizeWith = "number" | "trimmed-string" | "enum-ci";

// ── Field mapping edge ──

export interface FieldMappingEdge {
  system: ExternalSystem;
  externalField: string;
  /** Internal product field name. */
  internalField: string;
  normalizeWith: NormalizeWith;
  /** Restricts this edge to bidirectional, push-only, or pull-only.
   *  Default (undefined) = bidirectional. */
  direction?: "push-only" | "pull-only";
  /** Only active when the product's category is in this list. */
  condition?: { category: string[] };
  /** Auto-paired companion field name (e.g., vendor_name ↔ vendor_id). */
  companion?: string;
  /** Pre-write transform key (e.g., "zuperCategoryUid").
   *  Runs at execution time before the external API call. */
  transform?: string;
}

// ── Field value snapshot (server returns at preview time) ──

export interface FieldValueSnapshot {
  system: ExternalSystem | "internal";
  field: string;
  rawValue: string | number | null;
  normalizedValue: string | number | null;
}

// ── Sync plan (server-derived from intents + snapshots) ──

export type SyncOperation =
  | {
      kind: "pull";
      system: ExternalSystem;
      externalField: string;
      internalField: string;
      value: string | number | null;
      updateInternal: boolean;
      noOp?: boolean;
      source: "manual";
    }
  | {
      kind: "push";
      system: ExternalSystem;
      externalField: string;
      value: string | number | null;
      source: "manual" | "cascade";
    }
  | {
      kind: "create";
      system: ExternalSystem;
      fields: Record<string, string | number | null>;
      source: "manual" | "cascade";
    };

export interface PullConflict {
  internalField: string;
  contenders: Array<{
    system: ExternalSystem;
    externalField: string;
    normalizedValue: string | number | null;
  }>;
}

export interface SyncPlan {
  productId: string;
  basePreviewHash: string;
  planHash: string;
  conflicts: PullConflict[];
  internalPatch: Record<string, string | number | null>;
  operations: SyncOperation[];
  summary: {
    pulls: number;
    internalWrites: number;
    pushes: number;
    creates: number;
  };
}

// ── Execution outcome ──

export interface SyncOperationOutcome {
  kind: "pull" | "push" | "create" | "internal-patch";
  system: ExternalSystem | "internal";
  status: "success" | "skipped" | "failed";
  message: string;
  fieldDetails: Array<{
    externalField: string;
    source: "manual" | "cascade";
  }>;
}

export interface SyncExecuteResponse {
  status: "success" | "partial" | "failed" | "stale" | "conflict";
  planHash: string;
  outcomes: SyncOperationOutcome[];
}
