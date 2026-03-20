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
  const [, setBasePreviewHash] = useState<string>("");
  const [globalUpdateInternal, setGlobalUpdateInternal] = useState(true);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);
  const [confirmText, setConfirmText] = useState("");

  const { applyCascade } = useSyncCascade({ mappings, snapshots });

  // ── Load data on open ──
  useEffect(() => {
    if (!isOpen) return;
    setStep("loading");
    setError(null);
    setPlan(null);
    setOutcomes([]);
    setConfirmText("");

    fetch(`/api/inventory/products/${internalProductId}/sync`)
      .then((r) => r.json())
      .then((data) => {
        setSnapshots(data.snapshots);
        setMappings(data.mappings);
        setIntents(data.defaultIntents);
        setBasePreviewHash(data.basePreviewHash);
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
          intent.updateInternalOnPull = newValue;
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
          if (intent.mode === "manual") {
            updated[system][field] = { ...intent, mode: "auto" };
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

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="pb-2">Field</th>
                        <th className="pb-2">Direction</th>
                        <th className="pb-2">Internal</th>
                        <th className="pb-2">External</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sysMappings.map((edge) => {
                        const intent = intents[system]?.[edge.externalField];
                        if (!intent) return null;
                        const internalVal = getSnapshotValue("internal", edge.internalField);
                        const externalVal = getSnapshotValue(system, edge.externalField);

                        return (
                          <tr key={edge.externalField} className="border-t border-border/50">
                            <td className="py-2 text-foreground">
                              {edge.externalField}
                              {intent.mode === "auto" && (
                                <span className="ml-1 text-xs text-muted">(auto)</span>
                              )}
                            </td>
                            <td className="py-2">
                              <button
                                onClick={() => cycleDirection(system, edge.externalField)}
                                className={`rounded px-2 py-0.5 text-xs font-mono ${
                                  intent.direction === "push"
                                    ? "bg-green-500/10 text-green-400"
                                    : intent.direction === "pull"
                                      ? "bg-blue-500/10 text-blue-400"
                                      : "bg-surface-2 text-muted"
                                }`}
                              >
                                {intent.direction === "push" ? "\u2192 push" :
                                 intent.direction === "pull" ? "\u2190 pull" : "\u2014 skip"}
                              </button>
                              {intent.direction === "pull" && (
                                <label className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                                  <input
                                    type="checkbox"
                                    checked={intent.updateInternalOnPull}
                                    onChange={() => toggleFieldUpdateInternal(system, edge.externalField)}
                                    className="rounded"
                                  />
                                  save
                                </label>
                              )}
                            </td>
                            <td className="py-2 font-mono text-xs text-muted">
                              {internalVal ?? "\u2014"}
                            </td>
                            <td className="py-2 font-mono text-xs text-muted">
                              {externalVal ?? "\u2014"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                    className="flex items-center gap-2 rounded px-2 py-1 text-muted"
                  >
                    <span className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                      op.kind === "pull"
                        ? "bg-blue-500/10 text-blue-400"
                        : op.kind === "push"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {op.kind}
                    </span>
                    <span>{op.system}</span>
                    <span className="font-mono">
                      {op.kind === "create" ? `(${Object.keys(op.fields).length} fields)` : op.externalField}
                    </span>
                    {op.source === "cascade" && (
                      <span className="text-xs text-yellow-400">(cascaded)</span>
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
