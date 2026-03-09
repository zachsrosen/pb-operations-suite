/**
 * Scenario Manager
 *
 * Full CRUD UI for scenario management:
 * - Add / duplicate / rename / delete scenarios
 * - Edit equipment overrides per scenario
 * - Visual status badges (pending / has result)
 * - Integrates with ScenarioCompareTable and ScenarioRunPanel
 */

"use client";

import { useState, useCallback } from "react";
import type { AnalysisResult } from "@/lib/solar/adapters/worker-to-ui";
import type {
  Scenario,
  ScenarioOverride,
  ScenarioResult,
  ScenariosJson,
} from "@/lib/solar/scenarios/scenario-types";
import {
  analysisResultToScenarioResult,
} from "@/lib/solar/scenarios/scenario-types";
import {
  createScenario,
  duplicateScenario,
  renameScenario,
  deleteScenario,
  updateScenarioOverrides,
  setScenarioResult,
  computeDeltas,
  hasMixedQualityWarning,
  scenarioStats,
} from "@/lib/solar/scenarios/scenario-logic";
import { getBuiltInEquipment } from "@/lib/solar/equipment-catalog";
import ScenarioCompareTable from "./ScenarioCompareTable";
import ScenarioRunPanel from "./ScenarioRunPanel";
import type { WorkerRunMessage } from "@/lib/solar/types";

interface ScenarioManagerProps {
  /** Current project ID */
  projectId: string;
  /** Current scenarios JSON from project */
  scenarios: ScenariosJson;
  /** Callback to persist updated scenarios */
  onScenariosChange: (scenarios: ScenariosJson) => void;
  /** Baseline analysis result (current project config) */
  baselineResult: AnalysisResult;
  /** Baseline display name */
  baselineName: string;
  /** Whether baseline is a quick estimate */
  baselineIsQuickEstimate: boolean;
  /** Base worker payload for running scenario simulations */
  basePayload: WorkerRunMessage["payload"];
}

export default function ScenarioManager({
  projectId,
  scenarios,
  onScenariosChange,
  baselineResult,
  baselineName,
  baselineIsQuickEstimate,
  basePayload,
}: ScenarioManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const equipment = getBuiltInEquipment();
  const stats = scenarioStats(scenarios);

  const baselineScenarioResult = analysisResultToScenarioResult(baselineResult);

  const deltas = computeDeltas(scenarios, baselineScenarioResult);
  const hasMixed = hasMixedQualityWarning(scenarios, baselineIsQuickEstimate);

  // ── CRUD Handlers ─────────────────────────────────────────

  const handleAdd = useCallback(() => {
    const name = newName.trim() || `Scenario ${scenarios.length + 1}`;
    const updated = createScenario(scenarios, name);
    onScenariosChange(updated);
    setNewName("");
  }, [scenarios, newName, onScenariosChange]);

  const handleDuplicate = useCallback(
    (id: string) => {
      const updated = duplicateScenario(scenarios, id);
      onScenariosChange(updated);
    },
    [scenarios, onScenariosChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const updated = deleteScenario(scenarios, id);
      onScenariosChange(updated);
      if (editingId === id) setEditingId(null);
    },
    [scenarios, onScenariosChange, editingId]
  );

  const handleStartRename = useCallback(
    (scenario: Scenario) => {
      setRenamingId(scenario.id);
      setRenameValue(scenario.name);
    },
    []
  );

  const handleConfirmRename = useCallback(() => {
    if (!renamingId) return;
    const updated = renameScenario(scenarios, renamingId, renameValue);
    onScenariosChange(updated);
    setRenamingId(null);
    setRenameValue("");
  }, [scenarios, renamingId, renameValue, onScenariosChange]);

  const handleOverrideChange = useCallback(
    (id: string, overrides: ScenarioOverride) => {
      const updated = updateScenarioOverrides(scenarios, id, overrides);
      onScenariosChange(updated);
    },
    [scenarios, onScenariosChange]
  );

  const handleRunComplete = useCallback(
    (scenarioId: string, result: ScenarioResult) => {
      const updated = setScenarioResult(scenarios, scenarioId, result);
      onScenariosChange(updated);
    },
    [scenarios, onScenariosChange]
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-4 sm:space-y-6" role="region" aria-label="Scenario management">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Scenarios</h3>
          <p className="text-xs text-muted mt-0.5">
            {stats.total === 0
              ? "Create scenarios to compare equipment alternatives"
              : `${stats.total} scenario${stats.total !== 1 ? "s" : ""} · ${stats.withResults} with results`}
          </p>
        </div>
      </div>

      {/* Add scenario */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="New scenario name..."
          aria-label="New scenario name"
          className="flex-1 px-3 py-2 sm:py-1.5 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-orange-500/50 focus-visible:ring-2 focus-visible:ring-orange-400/50"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-2 sm:py-1.5 rounded-md bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50"
        >
          Add Scenario
        </button>
      </div>

      {/* Scenario list */}
      {scenarios.length > 0 && (
        <div className="space-y-2">
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50"
            >
              {/* Scenario header */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
                {/* Name / rename */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {renamingId === scenario.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirmRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                        aria-label="Rename scenario"
                        className="flex-1 min-w-0 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-600 text-sm text-foreground focus:outline-none focus:border-orange-500/50 focus-visible:ring-2 focus-visible:ring-orange-400/50"
                      />
                      <button
                        onClick={handleConfirmRename}
                        className="text-xs text-emerald-400 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 rounded"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        className="text-xs text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-foreground truncate">
                        {scenario.name}
                      </span>
                      <StatusBadge scenario={scenario} />
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => handleStartRename(scenario)}
                    className="px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50 rounded"
                    title="Rename"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() =>
                      setEditingId(editingId === scenario.id ? null : scenario.id)
                    }
                    className="px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50 rounded"
                    aria-expanded={editingId === scenario.id}
                    title="Edit overrides"
                  >
                    {editingId === scenario.id ? "Close" : "Edit"}
                  </button>
                  <button
                    onClick={() => handleDuplicate(scenario.id)}
                    className="px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50 rounded"
                    title="Duplicate"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => handleDelete(scenario.id)}
                    className="px-2 py-1 text-[10px] text-red-400/60 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Override editor */}
              {editingId === scenario.id && (
                <OverrideEditor
                  scenario={scenario}
                  equipment={equipment}
                  onChange={(overrides) =>
                    handleOverrideChange(scenario.id, overrides)
                  }
                />
              )}

              {/* Run panel */}
              {!scenario.result && (
                <div className="px-4 pb-3">
                  <ScenarioRunPanel
                    scenario={scenario}
                    basePayload={basePayload}
                    baselineIsQuickEstimate={baselineIsQuickEstimate}
                    onRunComplete={(result) =>
                      handleRunComplete(scenario.id, result)
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Compare table — only show when we have deltas */}
      {deltas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">
            Comparison
          </h3>
          <ScenarioCompareTable
            baselineName={baselineName}
            baselineResult={baselineScenarioResult}
            deltas={deltas}
            hasMixedQuality={hasMixed}
          />
        </div>
      )}
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────

function StatusBadge({ scenario }: { scenario: Scenario }) {
  if (!scenario.result) {
    return (
      <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-medium">
        Pending
      </span>
    );
  }

  if (scenario.result.isQuickEstimate) {
    return (
      <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">
        QE
      </span>
    );
  }

  return (
    <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
      ✓ Result
    </span>
  );
}

// ── Override Editor ─────────────────────────────────────────

interface OverrideEditorProps {
  scenario: Scenario;
  equipment: ReturnType<typeof getBuiltInEquipment>;
  onChange: (overrides: ScenarioOverride) => void;
}

function OverrideEditor({ scenario, equipment, onChange }: OverrideEditorProps) {
  const ov = scenario.overrides;

  const handleEquipmentChange = (
    key: keyof Pick<ScenarioOverride, "panelKey" | "inverterKey" | "essKey" | "optimizerKey">,
    value: string
  ) => {
    onChange({
      ...ov,
      [key]: value === "" ? null : value,
    });
  };

  return (
    <div className="px-3 sm:px-4 pb-4 border-t border-zinc-800">
      <p className="text-[10px] text-muted mt-3 mb-2">
        Equipment overrides (blank = use baseline)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Panel override */}
        <div>
          <label className="block text-[10px] text-muted mb-1">Panel</label>
          <select
            value={ov.panelKey ?? ""}
            onChange={(e) => handleEquipmentChange("panelKey", e.target.value)}
            className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-foreground focus:outline-none focus:border-orange-500/50"
          >
            <option value="">Baseline</option>
            {Object.entries(equipment.panels).map(([key, panel]) => (
              <option key={key} value={key}>
                {panel.name}
              </option>
            ))}
          </select>
        </div>

        {/* Inverter override */}
        <div>
          <label className="block text-[10px] text-muted mb-1">Inverter</label>
          <select
            value={ov.inverterKey ?? ""}
            onChange={(e) => handleEquipmentChange("inverterKey", e.target.value)}
            className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-foreground focus:outline-none focus:border-orange-500/50"
          >
            <option value="">Baseline</option>
            {Object.entries(equipment.inverters).map(([key, inv]) => (
              <option key={key} value={key}>
                {inv.name}
              </option>
            ))}
          </select>
        </div>

        {/* ESS override */}
        <div>
          <label className="block text-[10px] text-muted mb-1">Battery (ESS)</label>
          <select
            value={ov.essKey ?? ""}
            onChange={(e) => handleEquipmentChange("essKey", e.target.value)}
            className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-foreground focus:outline-none focus:border-orange-500/50"
          >
            <option value="">Baseline</option>
            <option value="None">None</option>
            {Object.entries(equipment.ess).map(([key, ess]) => (
              <option key={key} value={key}>
                {ess.name}
              </option>
            ))}
          </select>
        </div>

        {/* Optimizer override */}
        <div>
          <label className="block text-[10px] text-muted mb-1">Optimizer</label>
          <select
            value={ov.optimizerKey ?? ""}
            onChange={(e) => handleEquipmentChange("optimizerKey", e.target.value)}
            className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-foreground focus:outline-none focus:border-orange-500/50"
          >
            <option value="">Baseline</option>
            <option value="None">None</option>
            {Object.entries(equipment.optimizers).map(([key, opt]) => (
              <option key={key} value={key}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Result cleared warning */}
      {scenario.lastRunAt && !scenario.result && (
        <p className="text-[10px] text-yellow-400/60 mt-2">
          Overrides changed — re-run to update results.
        </p>
      )}
    </div>
  );
}
