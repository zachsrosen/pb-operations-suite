// src/lib/catalog-sync-plan.ts

import { createHash } from "crypto";
import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  SyncPlan,
  SyncOperation,
  PullConflict,
  SyncOperationOutcome,
  SyncExecuteResponse,
} from "./catalog-sync-types";
import { EXTERNAL_SYSTEMS, SYSTEM_PRECEDENCE } from "./catalog-sync-types";
import {
  getActiveMappings,
  getSystemMappings,
  getPushableMappings,
  normalize,
  normalizedEqual,
} from "./catalog-sync-mappings";
import type { SkuRecord } from "./catalog-sync";
import { getSpecData } from "./catalog-sync";
import { zohoInventory } from "./zoho-inventory";
import { getHubSpotProductById } from "./hubspot";
import { getZuperPartById } from "./zuper-catalog";
import {
  getHubSpotPropertyNames,
  parseZohoCurrentFields,
  parseHubSpotCurrentFields,
  parseZuperCurrentFields,
  executeZohoSync,
  executeHubSpotSync,
  executeZuperSync,
} from "./catalog-sync";
import { prisma } from "./db";

// ── Snapshot building ──

/** Fetch current field values from all external systems + internal state.
 *  Returns flat array of FieldValueSnapshot entries. */
export async function buildSnapshots(
  sku: SkuRecord,
  category: string,
): Promise<FieldValueSnapshot[]> {
  const snapshots: FieldValueSnapshot[] = [];
  const activeMappings = getActiveMappings(category);

  // Internal snapshots — from the SkuRecord itself
  const internalValues = buildInternalSnapshot(sku, activeMappings);
  snapshots.push(...internalValues);

  // External snapshots — fetched in parallel
  const [zohoSnaps, hubspotSnaps, zuperSnaps] = await Promise.all([
    buildExternalSnapshot("zoho", sku, activeMappings),
    buildExternalSnapshot("hubspot", sku, activeMappings),
    buildExternalSnapshot("zuper", sku, activeMappings),
  ]);
  snapshots.push(...zohoSnaps, ...hubspotSnaps, ...zuperSnaps);

  return snapshots;
}

function buildInternalSnapshot(
  sku: SkuRecord,
  mappings: FieldMappingEdge[],
): FieldValueSnapshot[] {
  const snapshots: FieldValueSnapshot[] = [];
  const seen = new Set<string>();

  for (const edge of mappings) {
    if (seen.has(edge.internalField)) continue;
    seen.add(edge.internalField);

    const rawValue = getSkuFieldValue(sku, edge.internalField);

    snapshots.push({
      system: "internal",
      field: edge.internalField,
      rawValue,
      normalizedValue: normalize(rawValue, edge.normalizeWith),
    });
  }
  return snapshots;
}

async function buildExternalSnapshot(
  system: ExternalSystem,
  sku: SkuRecord,
  mappings: FieldMappingEdge[],
): Promise<FieldValueSnapshot[]> {
  const systemMappings = mappings.filter((e) => e.system === system);
  if (systemMappings.length === 0) return [];

  const externalFields = await fetchExternalFields(system, sku);
  if (!externalFields) return []; // system not linked

  const snapshots: FieldValueSnapshot[] = [];
  for (const edge of systemMappings) {
    const rawValue = externalFields[edge.externalField] ?? null;
    snapshots.push({
      system,
      field: edge.externalField,
      rawValue,
      normalizedValue: normalize(rawValue, edge.normalizeWith),
    });
  }
  return snapshots;
}

async function fetchExternalFields(
  system: ExternalSystem,
  sku: SkuRecord,
): Promise<Record<string, string | null> | null> {
  try {
    switch (system) {
      case "zoho": {
        if (!sku.zohoItemId) return null;
        const item = await zohoInventory.getItemById(sku.zohoItemId);
        if (!item) return null;
        return parseZohoCurrentFields(item as unknown as Record<string, unknown>);
      }
      case "hubspot": {
        if (!sku.hubspotProductId) return null;
        const props = getHubSpotPropertyNames(sku);
        const product = await getHubSpotProductById(sku.hubspotProductId, props);
        if (!product) return null;
        return parseHubSpotCurrentFields(product);
      }
      case "zuper": {
        if (!sku.zuperItemId) return null;
        const part = await getZuperPartById(sku.zuperItemId);
        if (!part) return null;
        return parseZuperCurrentFields(part);
      }
    }
  } catch {
    return null;
  }
}

/** Read a field value from the SkuRecord by field name. */
function getSkuFieldValue(sku: SkuRecord, field: string): string | number | null {
  // Check spec data for category-specific fields
  const specData = getSpecData(sku);
  if (specData && field in specData) {
    const v = specData[field];
    if (v === null || v === undefined) return null;
    return typeof v === "number" ? v : String(v);
  }
  // Check core SkuRecord fields
  const v = (sku as unknown as Record<string, unknown>)[field];
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : String(v);
}

// ── Default intents ──

/** Derive default field intents from snapshots.
 *  - Fields with a diff: push / manual
 *  - Fields with no diff: skip / auto
 *  - Fields on unlinked systems (create): push / manual for all mapped fields
 */
export function deriveDefaultIntents(
  sku: SkuRecord,
  snapshots: FieldValueSnapshot[],
  category: string,
): Record<ExternalSystem, Record<string, FieldIntent>> {
  const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
    zoho: {},
    hubspot: {},
    zuper: {},
  };

  for (const system of EXTERNAL_SYSTEMS) {
    const isLinked = isSystemLinked(system, sku);
    const systemMappings = getSystemMappings(system, category);

    for (const edge of systemMappings) {
      // Push-only fields don't get user intents — server auto-includes them
      if (edge.direction === "push-only") continue;

      if (!isLinked) {
        // Unlinked system = create: all fields default to push/manual
        intents[system][edge.externalField] = {
          direction: "push",
          mode: "manual",
          updateInternalOnPull: true,
        };
        continue;
      }

      // Check if internal vs external differs
      const internalSnap = snapshots.find(
        (s) => s.system === "internal" && s.field === edge.internalField,
      );
      const externalSnap = snapshots.find(
        (s) => s.system === system && s.field === edge.externalField,
      );

      const hasDiff = !normalizedEqual(
        internalSnap?.rawValue,
        externalSnap?.rawValue,
        edge.normalizeWith,
      );

      intents[system][edge.externalField] = {
        direction: hasDiff ? "push" : "skip",
        mode: hasDiff ? "manual" : "auto",
        updateInternalOnPull: true,
      };
    }
  }

  return intents;
}

function isSystemLinked(system: ExternalSystem, sku: SkuRecord): boolean {
  switch (system) {
    case "zoho": return !!sku.zohoItemId;
    case "hubspot": return !!sku.hubspotProductId;
    case "zuper": return !!sku.zuperItemId;
  }
}

// ── Hash helpers ──

/** Hash raw external snapshots for basePreviewHash (informational). */
export function computeBasePreviewHash(snapshots: FieldValueSnapshot[]): string {
  const external = snapshots
    .filter((s) => s.system !== "internal")
    .sort((a, b) => `${a.system}:${a.field}`.localeCompare(`${b.system}:${b.field}`));
  return createHash("sha256").update(JSON.stringify(external)).digest("hex");
}

// ── Plan derivation ──

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

/** Derive a canonical sync plan from user intents + fresh snapshots.
 *  This is the core server-side logic called by POST /sync/plan and POST /sync/execute. */
export function derivePlan(
  sku: SkuRecord,
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  snapshots: FieldValueSnapshot[],
  category: string,
): SyncPlan {
  const activeMappings = getActiveMappings(category);

  // Step 1: Derive pull operations from intents
  const pulls = derivePullOperations(intents, activeMappings, snapshots);

  // Step 2: Detect conflicts (pass mappings for correct normalizeWith lookup)
  const conflicts = detectConflicts(pulls, activeMappings);

  // Step 3: Compute effective internal state (with relay-only overlays)
  const { internalPatch, effectiveState } = computeEffectiveState(
    sku, pulls, activeMappings,
  );

  // Step 4: Derive push and create operations
  const pushesAndCreates = derivePushOperations(
    sku, intents, activeMappings, effectiveState,
  );

  const allOps: SyncOperation[] = [...pulls, ...pushesAndCreates];

  // Step 5: Mark no-op pulls (pass mappings for field-level downstream check)
  markNoOpPulls(allOps, activeMappings);

  // Step 6: Compute hashes
  const basePreviewHash = computeBasePreviewHash(snapshots);
  const planHash = computePlanHash(sku.id, internalPatch, allOps);

  return {
    productId: sku.id,
    basePreviewHash,
    planHash,
    conflicts,
    internalPatch,
    operations: allOps,
    summary: {
      pulls: allOps.filter((o) => o.kind === "pull" && !o.noOp).length,
      internalWrites: Object.keys(internalPatch).length,
      pushes: allOps.filter((o) => o.kind === "push").length,
      creates: allOps.filter((o) => o.kind === "create").length,
    },
  };
}

// ── Pull operations ──

function derivePullOperations(
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
): SyncOperation[] {
  const pulls: SyncOperation[] = [];

  for (const system of EXTERNAL_SYSTEMS) {
    const systemIntents = intents[system] ?? {};
    for (const [externalField, intent] of Object.entries(systemIntents)) {
      if (intent.direction !== "pull") continue;

      const edge = mappings.find(
        (e) => e.system === system && e.externalField === externalField,
      );
      if (!edge || edge.direction === "push-only") continue;

      const snap = snapshots.find(
        (s) => s.system === system && s.field === externalField,
      );

      pulls.push({
        kind: "pull",
        system,
        externalField,
        internalField: edge.internalField,
        value: snap?.rawValue ?? null,
        updateInternal: intent.updateInternalOnPull,
        source: "manual",
      });

      // Auto-expand companion fields
      if (edge.companion) {
        const companionEdge = mappings.find(
          (e) => e.system === system && e.externalField === edge.companion,
        );
        if (companionEdge && !pulls.some(
          (p) => p.kind === "pull" && p.system === system &&
                 p.externalField === edge.companion,
        )) {
          const companionSnap = snapshots.find(
            (s) => s.system === system && s.field === edge.companion,
          );
          pulls.push({
            kind: "pull",
            system,
            externalField: edge.companion!,
            internalField: companionEdge.internalField,
            value: companionSnap?.rawValue ?? null,
            updateInternal: intent.updateInternalOnPull,
            source: "manual",
          });
        }
      }
    }
  }

  return pulls;
}

// ── Conflict detection ──

type PullOperation = Extract<SyncOperation, { kind: "pull" }>;

function detectConflicts(
  pulls: SyncOperation[],
  mappings: FieldMappingEdge[],
): PullConflict[] {
  // Group pulls by internalField
  const groups = new Map<string, PullOperation[]>();
  for (const pull of pulls) {
    if (pull.kind !== "pull") continue;
    const key = pull.internalField;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pull);
  }

  const conflicts: PullConflict[] = [];
  for (const [internalField, fieldPulls] of groups) {
    if (fieldPulls.length < 2) continue;

    // Look up normalizeWith from the mapping edge for this internal field
    const edge = mappings.find((e) => e.internalField === internalField);
    const normalizeWith = edge?.normalizeWith ?? "trimmed-string";
    const uniqueNormalized = new Set(
      fieldPulls.map((p) => String(normalize(p.value, normalizeWith) ?? "")),
    );

    if (uniqueNormalized.size > 1) {
      conflicts.push({
        internalField,
        contenders: fieldPulls.map((p) => ({
          system: p.system as ExternalSystem,
          externalField: p.externalField,
          normalizedValue: normalize(p.value, normalizeWith),
        })),
      });
    }
  }
  return conflicts;
}

// ── Effective state computation ──

function computeEffectiveState(
  sku: SkuRecord,
  pulls: SyncOperation[],
  mappings: FieldMappingEdge[],
): { internalPatch: Record<string, string | number | null>; effectiveState: Record<string, string | number | null> } {
  const internalPatch: Record<string, string | number | null> = {};
  const effectiveState: Record<string, string | number | null> = {};

  // Start with current internal values
  for (const edge of mappings) {
    const current = getSkuFieldValue(sku, edge.internalField);
    effectiveState[edge.internalField] = current;
  }

  // Apply pulls. For equal-normalized multi-pulls, use system precedence.
  const pullsByInternal = new Map<string, PullOperation[]>();
  for (const pull of pulls) {
    if (pull.kind !== "pull") continue;
    if (!pullsByInternal.has(pull.internalField)) pullsByInternal.set(pull.internalField, []);
    pullsByInternal.get(pull.internalField)!.push(pull);
  }

  for (const [internalField, fieldPulls] of pullsByInternal) {
    // Pick winner by system precedence
    const winner = [...fieldPulls].sort(
      (a, b) =>
        SYSTEM_PRECEDENCE.indexOf(a.system as ExternalSystem) -
        SYSTEM_PRECEDENCE.indexOf(b.system as ExternalSystem),
    )[0];

    effectiveState[internalField] = winner.value;

    // Only add to internalPatch if at least one pull has updateInternal=true
    const anyPersist = fieldPulls.some((p) => p.updateInternal);
    if (anyPersist) {
      internalPatch[internalField] = winner.value;
    }
  }

  return { internalPatch, effectiveState };
}

// ── Push/create operation derivation ──

function derivePushOperations(
  sku: SkuRecord,
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  mappings: FieldMappingEdge[],
  effectiveState: Record<string, string | number | null>,
): SyncOperation[] {
  const ops: SyncOperation[] = [];

  for (const system of EXTERNAL_SYSTEMS) {
    const isLinked = isSystemLinked(system, sku);
    const systemIntents = intents[system] ?? {};
    const systemMappings = mappings.filter(
      (e) => e.system === system && e.direction !== "push-only",
    );

    if (!isLinked) {
      // Create operation: collect all pushable field values
      const hasAnyPush = Object.values(systemIntents).some(
        (i) => i.direction === "push",
      );
      if (hasAnyPush) {
        const fields: Record<string, string | number | null> = {};
        const pushableMappings = getPushableMappings(system, sku.category);
        for (const edge of pushableMappings) {
          if (edge.direction === "push-only") continue;
          fields[edge.externalField] = effectiveState[edge.internalField] ?? null;
        }
        ops.push({
          kind: "create",
          system,
          fields,
          source: "manual",
        });
      }
      continue;
    }

    // Push operations for linked systems
    for (const [externalField, intent] of Object.entries(systemIntents)) {
      if (intent.direction !== "push") continue;

      const edge = systemMappings.find((e) => e.externalField === externalField);
      if (!edge) continue;

      const value = effectiveState[edge.internalField] ?? null;
      ops.push({
        kind: "push",
        system,
        externalField,
        value,
        source: intent.mode === "auto" ? "cascade" : "manual",
      });
    }
  }

  return ops;
}

function getSpecTableForSku(sku: SkuRecord): string | null {
  if (sku.moduleSpec) return "moduleSpec";
  if (sku.inverterSpec) return "inverterSpec";
  if (sku.batterySpec) return "batterySpec";
  if (sku.evChargerSpec) return "evChargerSpec";
  if (sku.mountingHardwareSpec) return "mountingHardwareSpec";
  if (sku.electricalHardwareSpec) return "electricalHardwareSpec";
  if (sku.relayDeviceSpec) return "relayDeviceSpec";
  return null;
}

// ── No-op marking ──

function markNoOpPulls(
  operations: SyncOperation[],
  mappings: FieldMappingEdge[],
): void {
  for (const op of operations) {
    if (op.kind !== "pull") continue;
    if (op.updateInternal) continue; // persists to DB, not a no-op

    // A relay-only pull is no-op if no downstream push/create on another
    // system touches a field whose mapping shares this pull's internalField.
    const siblingExternalFields = mappings
      .filter(
        (e) =>
          e.internalField === op.internalField &&
          e.system !== op.system &&
          e.direction !== "pull-only",
      )
      .map((e) => `${e.system}:${e.externalField}`);

    const hasDownstream = operations.some(
      (other) =>
        other !== op &&
        (other.kind === "push" || other.kind === "create") &&
        (other.kind === "push"
          ? siblingExternalFields.includes(`${other.system}:${other.externalField}`)
          : siblingExternalFields.some((sf) => sf.startsWith(`${other.system}:`))),
    );

    if (!hasDownstream) {
      op.noOp = true;
    }
  }
}

// ── Plan hash ──

function opSortKey(op: SyncOperation): string {
  const field = op.kind === "create" ? "create" : op.externalField;
  return `${op.kind}:${op.system}:${field}`;
}

function canonicalizeOp(op: SyncOperation): Record<string, unknown> {
  if (op.kind === "pull") {
    return {
      kind: op.kind, system: op.system, externalField: op.externalField,
      internalField: op.internalField, value: op.value,
      updateInternal: op.updateInternal,
    };
  }
  if (op.kind === "push") {
    return {
      kind: op.kind, system: op.system, externalField: op.externalField,
      value: op.value, source: op.source,
    };
  }
  return {
    kind: op.kind, system: op.system,
    fields: sortKeys(op.fields as Record<string, unknown>),
    source: op.source,
  };
}

export function computePlanHash(
  productId: string,
  internalPatch: Record<string, string | number | null>,
  operations: SyncOperation[],
): string {
  const activeOps = operations.filter(
    (op) => !(op.kind === "pull" && op.noOp),
  );
  const canonical = {
    productId,
    internalPatch: sortKeys(internalPatch as Record<string, unknown>),
    operations: activeOps
      .sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)))
      .map(canonicalizeOp),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ── Plan execution ──

/** Execute a validated sync plan. Called by POST /sync/execute after stale check. */
export async function executePlan(
  sku: SkuRecord,
  plan: SyncPlan,
): Promise<SyncExecuteResponse> {
  const outcomes: SyncOperationOutcome[] = [];

  // Step 1: Apply internal patch (pass sku for spec-table field detection)
  if (Object.keys(plan.internalPatch).length > 0) {
    const patchOutcome = await applyInternalPatch(sku.id, plan.internalPatch, sku);
    outcomes.push(patchOutcome);
    if (patchOutcome.status === "failed") {
      return { status: "failed", planHash: plan.planHash, outcomes };
    }
  }

  // Step 2: Re-materialize outbound writes from effective state
  const effectiveState = await buildPostPatchEffectiveState(sku, plan);

  // Step 3: Execute external writes in parallel (one batch per system)
  const externalOps = plan.operations.filter(
    (op) => op.kind === "push" || op.kind === "create",
  );
  const systemGroups = groupBySystem(externalOps);

  const externalOutcomes = await Promise.all(
    Array.from(systemGroups.entries()).map(([system, ops]) =>
      executeSystemWrites(system, sku, ops, effectiveState),
    ),
  );
  outcomes.push(...externalOutcomes);

  // Step 4: Determine overall status
  const externalStatuses = externalOutcomes.map((o) => o.status);
  const anyFailed = externalStatuses.includes("failed");
  const allSuccess = externalStatuses.every(
    (s) => s === "success" || s === "skipped",
  );

  return {
    status: anyFailed ? "partial" : allSuccess ? "success" : "partial",
    planHash: plan.planHash,
    outcomes,
  };
}

async function applyInternalPatch(
  productId: string,
  patch: Record<string, string | number | null>,
  sku: SkuRecord,
): Promise<SyncOperationOutcome> {
  try {
    // Split patch into core InternalProduct fields vs spec-table fields.
    const coreData: Record<string, unknown> = {};
    const specData: Record<string, unknown> = {};
    const existingSpec = getSpecData(sku) ?? {};

    for (const [field, value] of Object.entries(patch)) {
      if (field in existingSpec) {
        specData[field] = value;
      } else {
        coreData[field] = value;
      }
    }

    const totalFields = Object.keys(coreData).length + Object.keys(specData).length;
    if (totalFields === 0) {
      return {
        kind: "internal-patch",
        system: "internal",
        status: "skipped",
        message: "No fields to update",
        fieldDetails: [],
      };
    }

    // Update core InternalProduct fields
    if (Object.keys(coreData).length > 0) {
      await prisma.internalProduct.update({
        where: { id: productId },
        data: coreData,
      });
    }

    // Update spec-table fields via the appropriate relation
    if (Object.keys(specData).length > 0) {
      const specTable = getSpecTableForSku(sku);
      if (specTable) {
        const specModel = specTable as keyof typeof prisma;
        await (prisma[specModel] as unknown as { update: (args: { where: { internalProductId: string }; data: Record<string, unknown> }) => Promise<unknown> }).update({
          where: { internalProductId: productId },
          data: specData,
        });
      }
    }

    return {
      kind: "internal-patch",
      system: "internal",
      status: "success",
      message: `Updated ${totalFields} field(s)`,
      fieldDetails: Object.keys(patch)
        .map((f) => ({
          externalField: f,
          source: "manual" as const,
        })),
    };
  } catch (err) {
    return {
      kind: "internal-patch",
      system: "internal",
      status: "failed",
      message: err instanceof Error ? err.message : "Internal patch failed",
      fieldDetails: [],
    };
  }
}

async function buildPostPatchEffectiveState(
  sku: SkuRecord,
  plan: SyncPlan,
): Promise<Record<string, string | number | null>> {
  const state: Record<string, string | number | null> = {};

  // Load current SKU values
  const activeMappings = getActiveMappings(sku.category);
  for (const edge of activeMappings) {
    state[edge.internalField] = getSkuFieldValue(sku, edge.internalField);
  }

  // Apply the persisted patch
  for (const [field, value] of Object.entries(plan.internalPatch)) {
    state[field] = value;
  }

  // Overlay relay-only pull values (updateInternal=false, not in internalPatch)
  for (const op of plan.operations) {
    if (op.kind === "pull" && !op.updateInternal && !op.noOp) {
      state[op.internalField] = op.value;
    }
  }

  return state;
}

function groupBySystem(
  ops: SyncOperation[],
): Map<ExternalSystem, SyncOperation[]> {
  const groups = new Map<ExternalSystem, SyncOperation[]>();
  for (const op of ops) {
    if (op.kind === "pull") continue;
    if (!groups.has(op.system)) groups.set(op.system, []);
    groups.get(op.system)!.push(op);
  }
  return groups;
}

async function executeSystemWrites(
  system: ExternalSystem,
  sku: SkuRecord,
  ops: SyncOperation[],
  effectiveState: Record<string, string | number | null>,
): Promise<SyncOperationOutcome> {
  const fieldDetails: SyncOperationOutcome["fieldDetails"] = [];
  for (const op of ops) {
    if (op.kind === "push") {
      fieldDetails.push({ externalField: op.externalField, source: op.source });
    } else if (op.kind === "create") {
      for (const field of Object.keys(op.fields)) {
        fieldDetails.push({ externalField: field, source: op.source });
      }
    }
  }

  try {
    const createOp = ops.find((o) => o.kind === "create");
    if (createOp && createOp.kind === "create") {
      return await executeCreate(system, sku, createOp, fieldDetails);
    }

    const pushOps = ops.filter((o): o is Extract<SyncOperation, { kind: "push" }> =>
      o.kind === "push",
    );
    if (pushOps.length === 0) {
      return { kind: "push", system, status: "skipped", message: "No changes", fieldDetails };
    }

    return await executePushes(system, sku, pushOps, effectiveState, fieldDetails);
  } catch (err) {
    return {
      kind: ops.some((o) => o.kind === "create") ? "create" : "push",
      system,
      status: "failed",
      message: err instanceof Error ? err.message : "External write failed",
      fieldDetails,
    };
  }
}

async function executeCreate(
  system: ExternalSystem,
  sku: SkuRecord,
  op: Extract<SyncOperation, { kind: "create" }>,
  fieldDetails: SyncOperationOutcome["fieldDetails"],
): Promise<SyncOperationOutcome> {
  const changes = Object.entries(op.fields).map(([field, value]) => ({
    field,
    currentValue: null,
    proposedValue: value != null ? String(value) : null,
  }));

  const preview = {
    system: system as "zoho" | "hubspot" | "zuper",
    externalId: null,
    linked: false,
    action: "create" as const,
    changes,
    noChanges: false,
  };

  const result = await executeSystemSync(system, sku, preview);

  return {
    kind: "create",
    system,
    status: result.status === "created" ? "success" : "failed",
    message: result.status === "created"
      ? `Created in ${system}`
      : `Failed to create in ${system}`,
    fieldDetails,
  };
}

async function executePushes(
  system: ExternalSystem,
  sku: SkuRecord,
  ops: Extract<SyncOperation, { kind: "push" }>[],
  _effectiveState: Record<string, string | number | null>,
  fieldDetails: SyncOperationOutcome["fieldDetails"],
): Promise<SyncOperationOutcome> {
  const changes = ops.map((op) => ({
    field: op.externalField,
    currentValue: null,
    proposedValue: op.value != null ? String(op.value) : null,
  }));

  const externalId = getExternalId(system, sku);

  const preview = {
    system: system as "zoho" | "hubspot" | "zuper",
    externalId,
    linked: true,
    action: "update" as const,
    changes,
    noChanges: false,
  };

  const result = await executeSystemSync(system, sku, preview);

  return {
    kind: "push",
    system,
    status: result.status === "updated" ? "success" : result.status === "skipped" ? "skipped" : "failed",
    message: result.status === "updated"
      ? `Pushed ${ops.length} field(s) to ${system}`
      : result.status === "skipped"
        ? "Skipped"
        : `Failed: ${result.status}`,
    fieldDetails,
  };
}

function getExternalId(system: ExternalSystem, sku: SkuRecord): string | null {
  switch (system) {
    case "zoho": return sku.zohoItemId;
    case "hubspot": return sku.hubspotProductId;
    case "zuper": return sku.zuperItemId;
  }
}

async function executeSystemSync(
  system: ExternalSystem,
  sku: SkuRecord,
  preview: { system: string; externalId: string | null; linked: boolean; action: string; changes: Array<{ field: string; currentValue: string | null; proposedValue: string | null }>; noChanges: boolean },
) {
  switch (system) {
    case "zoho": return executeZohoSync(sku, preview as Parameters<typeof executeZohoSync>[1]);
    case "hubspot": return executeHubSpotSync(sku, preview as Parameters<typeof executeHubSpotSync>[1]);
    case "zuper": return executeZuperSync(sku, preview as Parameters<typeof executeZuperSync>[1]);
  }
}
