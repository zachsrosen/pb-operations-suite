/**
 * Solar Engine — Payload Mapper
 *
 * Maps the loosely-typed WorkerRunMessage payload to the strongly-typed
 * RunnerInput expected by the engine.
 *
 * This is the boundary where untyped host data becomes typed engine data.
 * Defaults are applied for missing optional fields.
 *
 * Extracted from worker.ts [B3] to be the single canonical mapper used by
 * both the Web Worker and adapter/test code.
 */

import type { RunnerInput } from "./engine-types";
import type { WorkerRunMessage } from "../types";

export function mapPayloadToRunnerInput(
  payload: WorkerRunMessage["payload"]
): RunnerInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eq = payload.equipmentConfig as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = payload.stringsConfig as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lp = payload.lossProfile as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hc = payload.homeConsumptionConfig as any;

  return {
    panels: (payload.panelStats || []).map((p, i) => ({
      id: i,
      tsrf: p.tsrf || 0.8,
      points: [],
      panelKey: p.panelKey || "",
      segmentIndex: p.segmentIndex,
      bifacialGain: 1.0, // computed in runner
    })),
    shadeData: eq?.shadeData || {},
    strings: sc?.strings || [],
    inverters: sc?.inverters || [],
    resolvedPanels: eq?.resolvedPanels || {},
    resolvedInverters: eq?.resolvedInverters || {},
    resolvedOptimizer: eq?.resolvedOptimizer || null,
    resolvedEss: eq?.resolvedEss || null,
    architectureType: eq?.architectureType || "string",
    lossProfile: {
      soiling: lp?.soiling ?? 2.0,
      mismatch: lp?.mismatch ?? 2.0,
      dcWiring: lp?.dcWiring ?? 2.0,
      acWiring: lp?.acWiring ?? 1.0,
      availability: lp?.availability ?? 3.0,
      lid: lp?.lid ?? 1.5,
      snow: lp?.snow ?? 0.0,
      nameplate: lp?.nameplate ?? 1.0,
    },
    tmyData: payload.weatherData || null,
    homeConsumption: hc || null,
    groundAlbedo: payload.siteConditions?.groundAlbedo ?? 0.2,
    clippingThreshold: eq?.clippingThreshold ?? 1.0,
  };
}
