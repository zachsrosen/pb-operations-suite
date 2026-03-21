// src/components/catalog/SyncModal.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  ExternalSystem,
  Direction,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  SyncPlan,
  SyncOperationOutcome,
} from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";
import { useSyncCascade } from "@/hooks/useSyncCascade";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;
type Step = "loading" | "intents" | "plan-preview" | "executing" | "results";

const SYSTEM_LABELS: Record<ExternalSystem, string> = {
  zoho: "Zoho Inventory",
  hubspot: "HubSpot",
  zuper: "Zuper",
};

const FIELD_LABELS: Record<string, string> = {
  _name: "Name",
  _specification: "Specification",
  brand: "Brand",
  model: "Model",
  category: "Category",
  unitPrice: "Unit Price",
  description: "Description",
  dc_size: "DC Size (W)",
  efficiency: "Efficiency (%)",
  ac_output: "AC Output (W)",
  capacity_kwh: "Capacity (kWh)",
  power_kw: "Power (kW)",
  connector_type: "Connector Type",
  mount_type: "Mount Type",
  component_type: "Component Type",
  device_type: "Device Type",
};

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
  const [intents, setIntents] = useState<IntentsMap>({ zoho: {}, hubspot: {}, zuper: {} });
  const [serverDefaults, setServerDefaults] = useState<IntentsMap>({ zoho: {}, hubspot: {}, zuper: {} });
  const [globalUpdateInternal, setGlobalUpdateInternal] = useState(true);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);
  const [confirmText, setConfirmText] = useState("");

  const { applyCascade } = useSyncCascade({ mappings, snapshots });

  // ── Reset state when modal opens (adjust-state-during-render pattern) ──
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    setStep("loading");
    setError(null);
    setPlan(null);
    setOutcomes([]);
    setConfirmText("");
  }
  if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  // ── Fetch data on open ──
  useEffect(() => {
    if (!isOpen) return;

    fetch(`/api/inventory/products/${internalProductId}/sync`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load sync data");
        return r.json();
      })
      .then((data) => {
        setSnapshots(data.snapshots);
        setMappings(data.mappings);
        setIntents(data.defaultIntents);
        setServerDefaults(structuredClone(data.defaultIntents));
        setStep("intents");
      })
      .catch((err) => {
        setError(err.message);
        setStep("intents");
      });
  }, [isOpen, internalProductId]);

  // ── Helpers ──

  function getSnapshotValue(system: ExternalSystem | "internal", field: string) {
    return snapshots.find((s) => s.system === system && s.field === field)?.rawValue ?? null;
  }

  /**
   * Compute the effective internal value for a field, accounting for any
   * pending pull from another system. If system X is pulling a value into
   * internalField "foo", then when we render system Y's row for the same
   * internalField, we show the post-pull value instead of the stale current one.
   *
   * Uses SYSTEM_PRECEDENCE (zoho > hubspot > zuper) when multiple pulls target
   * the same internal field.
   *
   * Returns { value, saving } — `saving` is true when the upstream pull will
   * persist the value to the internal DB, false when it's relay-only.
   */
  function getEffectiveInternal(internalField: string): { value: string | number | null; saving: boolean } {
    const currentValue = getSnapshotValue("internal", internalField);

    // Find the highest-precedence pull targeting this internal field
    const precedence: ExternalSystem[] = ["zoho", "hubspot", "zuper"];
    for (const sys of precedence) {
      const sysIntents = intents[sys] ?? {};
      for (const [extField, intent] of Object.entries(sysIntents)) {
        if (intent.direction !== "pull") continue;
        const edge = mappings.find((e) => e.system === sys && e.externalField === extField);
        if (edge && edge.internalField === internalField) {
          return {
            value: getSnapshotValue(sys, extField),
            saving: intent.updateInternalOnPull,
          };
        }
      }
    }

    return { value: currentValue, saving: false };
  }

  function isSystemLinked(system: ExternalSystem): boolean {
    return snapshots.some((s) => s.system === system);
  }

  function getSystemMappings(system: ExternalSystem): FieldMappingEdge[] {
    return mappings.filter(
      (e) => e.system === system && e.direction !== "push-only",
    );
  }

  const hasAnyDiffs = Object.values(intents).some((sysIntents) =>
    Object.values(sysIntents).some((i) => i.direction !== "skip"),
  );

  // ── Direction cycling ──

  const cycleDirection = useCallback(
    (system: ExternalSystem, field: string) => {
      setIntents((prev) => {
        const current = prev[system]?.[field];
        if (!current) return prev;

        const edge = mappings.find(
          (e) => e.system === system && e.externalField === field,
        );
        const canPull = edge && edge.direction !== "push-only";
        const directions: Direction[] = canPull
          ? ["push", "skip", "pull"]
          : ["push", "skip"];

        const idx = directions.indexOf(current.direction);
        const next = directions[(idx + 1) % directions.length];

        const updated = structuredClone(prev);
        updated[system][field] = {
          direction: next,
          mode: "manual",
          updateInternalOnPull: current.updateInternalOnPull,
        };
        return applyCascade(updated);
      });
    },
    [mappings, applyCascade],
  );

  // ── Toggle update-internal per field ──

  function toggleFieldUpdateInternal(system: ExternalSystem, field: string) {
    setIntents((prev) => {
      const updated = structuredClone(prev);
      const intent = updated[system]?.[field];
      if (intent) {
        intent.updateInternalOnPull = !intent.updateInternalOnPull;
      }
      return updated;
    });
  }

  // ── Global update-internal toggle ──

  function handleGlobalUpdateInternalToggle() {
    const newValue = !globalUpdateInternal;
    setGlobalUpdateInternal(newValue);
    setIntents((prev) => {
      const updated = structuredClone(prev);
      for (const system of EXTERNAL_SYSTEMS) {
        for (const intent of Object.values(updated[system] ?? {})) {
          // Only seed auto-managed fields; preserve manual per-field overrides
          if (intent.mode === "auto") {
            intent.updateInternalOnPull = newValue;
          }
        }
      }
      return updated;
    });
  }

  // ── Reset auto decisions ──

  function resetAutoDecisions() {
    setIntents((prev) => {
      const updated = structuredClone(prev);
      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(updated[system] ?? {})) {
          // Only reset auto-managed (cascade-derived) fields back to server defaults;
          // preserve fields the user explicitly set (mode === "manual")
          if (intent.mode === "auto") {
            const serverDefault = serverDefaults[system]?.[field];
            if (serverDefault) {
              updated[system][field] = { ...serverDefault, mode: "auto" };
            }
          }
        }
      }
      return applyCascade(updated);
    });
  }

  // ── Preview plan ──

  async function handlePreviewPlan() {
    setError(null);
    try {
      const response = await fetch(
        `/api/inventory/products/${internalProductId}/sync/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intents }),
        },
      );
      if (!response.ok) {
        const err = await response.json();
        setError(err.error ?? "Failed to derive plan");
        return;
      }
      const data = await response.json();
      setPlan(data.plan);
      setStep("plan-preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview plan");
    }
  }

  // ── Execute ──

  async function handleExecute() {
    if (!plan) return;
    setStep("executing");
    setError(null);
    try {
      // 1. Get confirmation token
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
        setStep("plan-preview");
        return;
      }
      const { token, issuedAt } = await confirmRes.json();

      // 2. Execute via POST /sync
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
        setError("External state changed since preview. Please re-preview.");
        setStep("intents");
        return;
      }
      if (!execRes.ok) {
        setError(result.error ?? "Sync failed");
        setStep("plan-preview");
        return;
      }

      setOutcomes(result.outcomes);
      setStep("results");
      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setStep("plan-preview");
    }
  }

  // ── Render ──

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Sync: {skuName}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {step === "loading" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        )}

        {/* Intent Editor */}
        {step === "intents" && (
          <div className="space-y-6">
            {EXTERNAL_SYSTEMS.map((system) => {
              const sysMappings = getSystemMappings(system);
              const linked = isSystemLinked(system);
              if (sysMappings.length === 0) return null;

              return (
                <div key={system} className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium text-foreground">
                      {SYSTEM_LABELS[system]}
                    </h3>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${
                      linked
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-green-500/10 text-green-400"
                    }`}>
                      {linked ? "Update" : "Will Create"}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {sysMappings.map((edge) => {
                      const intent = intents[system]?.[edge.externalField];
                      if (!intent) return null;
                      // Use effective internal value (accounts for pending pulls from other systems)
                      const effective = getEffectiveInternal(edge.internalField);
                      const rawInternalVal = getSnapshotValue("internal", edge.internalField);
                      const externalVal = getSnapshotValue(system, edge.externalField);
                      const internalVal = intent.direction === "pull" ? rawInternalVal : effective.value;
                      const inSync = String(internalVal ?? "") === String(externalVal ?? "");
                      const displayInternal = internalVal ?? "\u2014";
                      const displayExternal = externalVal ?? "\u2014";
                      // Show hints when the effective value comes from a pull elsewhere
                      const hasUpstreamPull = intent.direction !== "pull" && String(effective.value ?? "") !== String(rawInternalVal ?? "");
                      const upstreamIsRelayOnly = hasUpstreamPull && !effective.saving;

                      return (
                        <div key={edge.externalField} className="rounded-lg border border-border/30 px-3 py-2">
                          {/* Row 1: field name + direction button */}
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-foreground">
                              {FIELD_LABELS[edge.internalField] ?? edge.internalField}
                              {intent.mode === "auto" && (
                                <span className="ml-1 text-xs text-muted">(auto)</span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => cycleDirection(system, edge.externalField)}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                  intent.direction === "push"
                                    ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                                    : intent.direction === "pull"
                                      ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                                      : "bg-surface-2 text-muted hover:text-foreground"
                                }`}
                              >
                                {intent.direction === "push" ? "Push \u2192" :
                                 intent.direction === "pull" ? "\u2190 Pull" : "Skip"}
                              </button>
                              {intent.direction === "pull" && (
                                <label className="inline-flex items-center gap-1 text-xs text-muted">
                                  <input
                                    type="checkbox"
                                    checked={intent.updateInternalOnPull}
                                    onChange={() => toggleFieldUpdateInternal(system, edge.externalField)}
                                    className="rounded"
                                  />
                                  save
                                </label>
                              )}
                            </div>
                          </div>

                          {/* Row 2: value flow visualization */}
                          <div className="mt-1.5 flex items-center gap-2 text-xs">
                            {intent.direction === "push" ? (
                              <>
                                <span className="rounded bg-green-500/10 px-1.5 py-0.5 font-mono font-medium text-green-400">
                                  {displayInternal}
                                </span>
                                {hasUpstreamPull && (
                                  <span className={`text-[10px] ${upstreamIsRelayOnly ? "text-yellow-400/60" : "text-blue-400/60"}`}>
                                    {upstreamIsRelayOnly ? "(relay only)" : "(via pull)"}
                                  </span>
                                )}
                                <span className="text-green-400/60">&rarr;</span>
                                <span className="font-mono text-muted line-through">
                                  {displayExternal}
                                </span>
                              </>
                            ) : intent.direction === "pull" ? (
                              <>
                                <span className="font-mono text-muted line-through">
                                  {displayInternal}
                                </span>
                                <span className="text-blue-400/60">&larr;</span>
                                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono font-medium text-blue-400">
                                  {displayExternal}
                                </span>
                              </>
                            ) : inSync ? (
                              <span className="font-mono text-muted">
                                {displayInternal} <span className="text-muted/50">=</span> {displayExternal}
                                {hasUpstreamPull && (
                                  <span className={`ml-1 ${upstreamIsRelayOnly ? "text-yellow-400/60" : "text-blue-400/60"}`}>
                                    {upstreamIsRelayOnly ? "(relay only)" : "(after pull)"}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <>
                                <span className="font-mono text-muted">{displayInternal}</span>
                                {hasUpstreamPull && (
                                  <span className={`text-[10px] ${upstreamIsRelayOnly ? "text-yellow-400/60" : "text-blue-400/60"}`}>
                                    {upstreamIsRelayOnly ? "(relay only)" : "(via pull)"}
                                  </span>
                                )}
                                <span className="text-muted/50">|</span>
                                <span className="font-mono text-muted">{displayExternal}</span>
                                <span className="text-yellow-400/60">(differs)</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Global controls */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={globalUpdateInternal}
                    onChange={handleGlobalUpdateInternalToggle}
                    className="rounded"
                  />
                  Update internal on pull
                </label>
                <button
                  onClick={resetAutoDecisions}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Reset auto decisions
                </button>
              </div>
              <button
                onClick={handlePreviewPlan}
                disabled={!hasAnyDiffs}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Preview Plan
              </button>
            </div>
          </div>
        )}

        {/* Plan Preview */}
        {step === "plan-preview" && plan && (
          <div className="space-y-4">
            <button
              onClick={() => setStep("intents")}
              className="text-sm text-muted hover:text-foreground"
            >
              &larr; Back to intents
            </button>

            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 text-center text-sm">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.pulls}</div>
                <div className="text-muted">Pulls</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.internalWrites}</div>
                <div className="text-muted">Internal</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.pushes}</div>
                <div className="text-muted">Pushes</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.creates}</div>
                <div className="text-muted">Creates</div>
              </div>
            </div>

            {/* Conflicts */}
            {plan.conflicts.length > 0 && (
              <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <strong>Pull conflict{plan.conflicts.length > 1 ? "s" : ""}:</strong>
                {plan.conflicts.map((c) => (
                  <div key={c.internalField} className="mt-1">
                    <code>{c.internalField}</code> has conflicting values from{" "}
                    {c.contenders.map((ct) => ct.system).join(", ")}. Resolve by
                    changing one to skip.
                  </div>
                ))}
              </div>
            )}

            {/* Operations list */}
            <div className="space-y-1 text-sm">
              {plan.operations
                .filter((op) => !(op.kind === "pull" && op.noOp))
                .map((op, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2"
                  >
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                      op.kind === "pull"
                        ? "bg-blue-500/15 text-blue-400"
                        : op.kind === "push"
                          ? "bg-green-500/15 text-green-400"
                          : "bg-purple-500/15 text-purple-400"
                    }`}>
                      {op.kind}
                    </span>
                    <span className="shrink-0 text-muted">{SYSTEM_LABELS[op.system as ExternalSystem] ?? op.system}</span>
                    <span className="font-mono text-foreground">
                      {op.kind === "create"
                        ? `${Object.keys(op.fields).length} fields`
                        : FIELD_LABELS[op.kind === "pull" ? op.internalField : op.externalField] ?? op.externalField}
                    </span>
                    {(op.kind === "push" || op.kind === "pull") && op.value != null && (
                      <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-xs ${
                        op.kind === "push"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-blue-500/10 text-blue-400"
                      }`}>
                        {String(op.value)}
                      </span>
                    )}
                    {op.source === "cascade" && (
                      <span className="shrink-0 text-xs text-yellow-400">(auto)</span>
                    )}
                  </div>
                ))}
            </div>

            {/* Confirm + Execute */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type "confirm" to execute'
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
              <button
                onClick={handleExecute}
                disabled={
                  confirmText !== "confirm" || plan.conflicts.length > 0
                }
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Execute Sync
              </button>
            </div>
          </div>
        )}

        {/* Executing */}
        {step === "executing" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              <p className="text-sm text-muted">Executing sync plan...</p>
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
                    {outcome.system === "internal" ? "Internal Product" : SYSTEM_LABELS[outcome.system as ExternalSystem]}
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
