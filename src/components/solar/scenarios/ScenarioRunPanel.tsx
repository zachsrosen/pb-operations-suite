/**
 * Scenario Run Panel
 *
 * Triggers a simulation run for a single scenario using the existing
 * Web Worker pipeline. Applies scenario overrides to the base payload,
 * then runs through useSimulation().
 *
 * Shows run/cancel/progress inline per scenario.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSimulation } from "@/lib/solar/hooks/useSimulation";
import { mapWorkerResultToUI } from "@/lib/solar/adapters/worker-to-ui";
import {
  analysisResultToScenarioResult,
  type ScenarioResult,
} from "@/lib/solar/scenarios/scenario-types";
import type { Scenario } from "@/lib/solar/scenarios/scenario-types";
import type { WorkerRunMessage } from "@/lib/solar/types";

interface ScenarioRunPanelProps {
  /** The scenario to run */
  scenario: Scenario;
  /** Base worker payload (from current project config) */
  basePayload: WorkerRunMessage["payload"];
  /** Whether the baseline project is a quick estimate */
  baselineIsQuickEstimate: boolean;
  /** Callback when simulation completes successfully */
  onRunComplete: (result: ScenarioResult) => void;
}

export default function ScenarioRunPanel({
  scenario,
  basePayload,
  baselineIsQuickEstimate,
  onRunComplete,
}: ScenarioRunPanelProps) {
  const { state, run, cancel } = useSimulation();

  /** Apply scenario overrides to base payload. */
  const scenarioPayload = useMemo(() => {
    const payload = JSON.parse(JSON.stringify(basePayload));
    const ov = scenario.overrides;

    // Equipment overrides — patch equipmentConfig
    const ec = (payload as Record<string, unknown>).equipmentConfig as
      | Record<string, unknown>
      | undefined;

    if (ec) {
      if (ov.panelKey !== undefined && ov.panelKey !== null) {
        ec.panelKey = ov.panelKey;
      }
      if (ov.inverterKey !== undefined && ov.inverterKey !== null) {
        ec.inverterKey = ov.inverterKey;
      }
      if (ov.essKey !== undefined && ov.essKey !== null) {
        ec.essKey = ov.essKey;
      }
      if (ov.optimizerKey !== undefined && ov.optimizerKey !== null) {
        ec.optimizerKey = ov.optimizerKey;
      }
    }

    // Loss profile overrides
    if (ov.lossProfile) {
      const lp = ((payload as Record<string, unknown>).lossProfile as
        | Record<string, unknown>
        | undefined) ?? {};
      (payload as Record<string, unknown>).lossProfile = {
        ...lp,
        ...ov.lossProfile,
      };
    }

    // Site conditions overrides
    if (ov.siteConditions) {
      const sc = ((payload as Record<string, unknown>).siteConditions as
        | Record<string, unknown>
        | undefined) ?? {};
      (payload as Record<string, unknown>).siteConditions = {
        ...sc,
        ...ov.siteConditions,
      };
    }

    return payload;
  }, [basePayload, scenario.overrides]);

  const handleRun = useCallback(() => {
    run(scenarioPayload);
  }, [run, scenarioPayload]);

  // Notify parent when simulation completes — use effect to avoid setState-during-render
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (state.status === "complete" && state.result && !notifiedRef.current) {
      notifiedRef.current = true;
      const uiResult = mapWorkerResultToUI(state.result, baselineIsQuickEstimate);
      const scenarioResult = analysisResultToScenarioResult(uiResult);
      onRunComplete(scenarioResult);
    }
    if (state.status !== "complete") {
      notifiedRef.current = false;
    }
  }, [state.status, state.result, baselineIsQuickEstimate, onRunComplete]);

  // ── Render ────────────────────────────────────────────────

  if (state.status === "idle") {
    return (
      <button
        onClick={handleRun}
        className="px-3 py-1 rounded-md bg-zinc-800 text-xs text-foreground hover:bg-zinc-700 transition-colors border border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50"
      >
        Run Scenario
      </button>
    );
  }

  if (state.status === "running") {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-valuenow={state.progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full bg-orange-500 rounded-full transition-all duration-300"
            style={{ width: `${state.progress.percent}%` }}
          />
        </div>
        <span className="text-[10px] text-muted whitespace-nowrap" aria-live="polite">
          {state.progress.stage} {state.progress.percent}%
        </span>
        <button
          onClick={cancel}
          className="px-2 py-0.5 rounded text-[10px] text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2" role="alert">
        <span className="text-[10px] text-red-400">
          Error: {state.error}
        </span>
        <button
          onClick={handleRun}
          className="px-2 py-0.5 rounded text-[10px] text-foreground bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50"
        >
          Retry
        </button>
      </div>
    );
  }

  // complete — already handled via callback, show nothing extra
  return null;
}
