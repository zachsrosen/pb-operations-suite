/**
 * Solar Engine — Runner (Orchestrator)
 *
 * Top-level entry point that runs the full simulation pipeline:
 * 1. Resolve equipment from catalog keys
 * 2. Prepare TMY weather lookup
 * 3. Generate consumption profile
 * 4. Compute bifacial gain per panel
 * 5. Run Model A (independent panel timeseries)
 * 6. Run Model B (string mismatch — string architecture only)
 * 7. Run Dispatch (energy balance, battery SOC)
 * 8. Compute system stats
 * 9. Return result
 *
 * Maps RunnerInput → SimulationResult → WorkerResultMessage payload.
 */

import { HALF_HOUR_FACTOR, sumToMonthly, sumTotal } from "./constants";
import type {
  RunnerInput,
  SimulationResult,
  ModelBResult,
} from "./engine-types";
import { computeMismatchLoss, getSystemDerate } from "./architecture";
import { runModelA } from "./model-a";
import { runModelB } from "./model-b";
import { runDispatch } from "./dispatch";
import { generateConsumptionProfile } from "./consumption";
import { prepareTmyLookup } from "./weather";
import { calculateBifacialGain } from "../types";
import type { WorkerProgressMessage } from "../types";

/** Schema version for the result payload [P2-F4] */
export const SCHEMA_VERSION = 1 as const;

/**
 * Result payload shape that matches the expanded WorkerResultMessage.
 */
export interface RunnerResult {
  schemaVersion: typeof SCHEMA_VERSION;
  modelA: { annualKwh: number; monthlyKwh: number[] };
  modelB: {
    annualKwh: number;
    monthlyKwh: number[];
    mismatchLossPct: number;
  } | null; // [P1-F3] null for non-string architectures
  dispatch?: {
    energyBalance: {
      totalProductionKwh: number;
      selfConsumedKwh: number;
      gridExportKwh: number;
      gridImportKwh: number;
      batteryChargedKwh: number;
      batteryDischargedKwh: number;
      batteryLossesKwh: number;
      curtailedKwh: number;
      clippedKwh: number;
      deltaStoredKwh: number; // [P1-F2]
    };
    clippingLossPct: number;
    curtailedKwh: number;
  };
  panelCount: number;
  systemSizeKw: number;
  systemTsrf: number;
  specificYield: number;
}

/**
 * Run the full simulation pipeline.
 *
 * @param input All data needed for simulation (from WorkerRunMessage.payload mapping)
 * @param reportProgress Callback for progress updates (0% → 100%)
 * @returns RunnerResult ready for postMessage
 */
export function runAnalysis(
  input: RunnerInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): RunnerResult {
  const {
    panels,
    shadeData,
    strings,
    inverters,
    resolvedPanels,
    resolvedInverters,
    architectureType,
    lossProfile,
    tmyData,
    homeConsumption,
    groundAlbedo,
    clippingThreshold,
  } = input;

  if (panels.length === 0) {
    return emptyResult();
  }

  // ── Step 1: Prepare TMY weather lookup ──────────────────────
  const tmyLookup = prepareTmyLookup(tmyData);
  const hasShade = Object.keys(shadeData).length > 0;

  // ── Step 2: Generate consumption profile ────────────────────
  const consumptionProfile = generateConsumptionProfile(homeConsumption);

  // ── Step 3: Compute bifacial gain per panel ─────────────────
  // Pre-compute once per run — applied as multiplier in Model A
  const panelsWithBifacial = panels.map((panel) => {
    const spec = resolvedPanels[panel.panelKey];
    if (!spec || !spec.isBifacial || !spec.bifacialityFactor) {
      return { ...panel, bifacialGain: panel.bifacialGain || 1.0 };
    }
    // Already computed if bifacialGain was set externally
    if (panel.bifacialGain && panel.bifacialGain !== 1.0) {
      return panel;
    }
    const gain = calculateBifacialGain({
      ghi: 1000, // STC reference — gain is a ratio, GHI cancels out
      albedo: groundAlbedo || 0.2,
      bifacialityFactor: spec.bifacialityFactor,
      tiltRadians: Math.PI / 6, // ~30° default tilt
      gcr: 0.4, // default ground coverage ratio
    });
    return { ...panel, bifacialGain: gain };
  });

  // ── Step 4: Run Model A ─────────────────────────────────────
  const modelA = runModelA(
    {
      panels: panelsWithBifacial,
      shadeData,
      resolvedPanels,
      tmyLookup,
      hasShade,
    },
    reportProgress
  );

  // ── Step 5: Run Model B (string architecture only) ──────────
  let modelB: ModelBResult | null = null;

  if (architectureType === "string" && strings.length > 0) {
    // Find primary panel key (first panel's key — V12 uses single panel type)
    const primaryPanelKey = panels[0]?.panelKey || "";

    modelB = runModelB(
      {
        panels: panelsWithBifacial,
        strings,
        shadeData,
        resolvedPanels,
        tmyLookup,
        hasShade,
        primaryPanelKey,
      },
      reportProgress
    );

    // Compute mismatch loss by comparing Model A vs Model B raw totals
    modelB.mismatchLossPct = computeMismatchLoss(
      modelA.annualKwh,
      modelB.annualKwh,
      architectureType
    );
  }

  // ── Step 6: Run Dispatch ────────────────────────────────────
  // Use Model B string timeseries if available (captures mismatch),
  // otherwise use Model A panel timeseries (micro/optimizer)
  const dispatchTimeseries =
    modelB && modelB.stringTimeseries.length > 0
      ? modelB.stringTimeseries
      : modelA.panelTimeseries;

  const dispatchResult = runDispatch(
    {
      stringTimeseries: dispatchTimeseries,
      inverters,
      resolvedInverters,
      clippingThreshold: clippingThreshold || 1.0,
      consumptionProfile,
      homeConsumption,
      exportLimitW: 0, // No export limit by default
    },
    reportProgress
  );

  // ── Step 7: Apply system derate ─────────────────────────────
  const systemDerate = getSystemDerate(lossProfile, architectureType);

  // Derate the annual/monthly values from Model A
  const deratedAnnualKwh = modelA.annualKwh * systemDerate;
  const deratedMonthlyKwh = modelA.monthlyKwh.map((v) => v * systemDerate);

  // Derate Model B if present
  let deratedModelB: RunnerResult["modelB"] = null;
  if (modelB) {
    deratedModelB = {
      annualKwh: modelB.annualKwh * systemDerate,
      monthlyKwh: modelB.monthlyKwh.map((v) => v * systemDerate),
      mismatchLossPct: modelB.mismatchLossPct,
    };
  }

  // ── Step 8: Compute system stats ────────────────────────────
  let totalDcW = 0;
  let weightedTsrf = 0;

  for (const panel of panels) {
    const spec = resolvedPanels[panel.panelKey];
    if (!spec) continue;
    totalDcW += spec.watts;
    weightedTsrf += spec.watts * (panel.tsrf || 0.8);
  }

  const systemSizeKw = totalDcW / 1000;
  const systemTsrf = totalDcW > 0 ? weightedTsrf / totalDcW : 0;
  const specificYield =
    systemSizeKw > 0 ? deratedAnnualKwh / systemSizeKw : 0;

  // ── Step 9: Final progress ──────────────────────────────────
  reportProgress({
    type: "SIMULATION_PROGRESS",
    payload: { percent: 100, stage: "Complete" },
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    modelA: {
      annualKwh: deratedAnnualKwh,
      monthlyKwh: deratedMonthlyKwh,
    },
    modelB: deratedModelB,
    dispatch: dispatchResult
      ? {
          energyBalance: dispatchResult.energyBalance,
          clippingLossPct: dispatchResult.clippingLossPct,
          curtailedKwh: dispatchResult.curtailedKwh,
        }
      : undefined,
    panelCount: panels.length,
    systemSizeKw,
    systemTsrf,
    specificYield,
  };
}

/**
 * Return an empty result for zero-panel systems.
 */
function emptyResult(): RunnerResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    modelA: { annualKwh: 0, monthlyKwh: new Array(12).fill(0) },
    modelB: null,
    panelCount: 0,
    systemSizeKw: 0,
    systemTsrf: 0,
    specificYield: 0,
  };
}
