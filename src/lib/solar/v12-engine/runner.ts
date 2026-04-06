/**
 * Solar Designer V12 Engine — Core Runner
 *
 * Orchestrates: equipment resolution -> PanelGeometry->PanelStat mapping ->
 * Model A -> Model B -> clipping detection -> system stats.
 *
 * Does NOT run dispatch (battery/energy balance) — that's Stage 5.
 */
import type {
  CoreSolarDesignerInput,
  CoreSolarDesignerResult,
  ClippingEvent,
  PanelStat,
} from './types';
import type { RunnerInput } from '../engine/engine-types';
import type { WorkerProgressMessage } from '../types';
import { resolvePanel, resolveInverter } from './equipment';
import { runModelA } from './production';
import { runModelB, computeMismatchLoss } from './mismatch';
import { prepareTmyLookup } from '../engine/weather';
import { getSystemDerate } from '../engine/architecture';
import { calculateBifacialGain } from '../types';

export const CORE_SCHEMA_VERSION = 2;

export function runCoreAnalysis(
  input: CoreSolarDesignerInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): CoreSolarDesignerResult {
  const { panels, shadeData, strings, equipment, siteConditions, lossProfile } = input;

  if (panels.length === 0) {
    return emptyResult();
  }

  // 1. Resolve equipment from built-in catalog
  const panelSpec = resolvePanel(equipment.panelKey);
  const inverterSpec = resolveInverter(equipment.inverterKey);

  if (!panelSpec || !inverterSpec) {
    return emptyResult(); // Can't run without equipment
  }

  // 2. Bridge PanelGeometry[] -> PanelStat[] (existing engine format)
  const resolvedPanels: Record<string, typeof panelSpec> = {
    [equipment.panelKey]: panelSpec,
  };

  // Compute bifacial gain if applicable
  let bifacialGain = 1.0;
  if (panelSpec.isBifacial && panelSpec.bifacialityFactor > 0) {
    bifacialGain = calculateBifacialGain({
      ghi: 1000,
      albedo: siteConditions.groundAlbedo || 0.2,
      bifacialityFactor: panelSpec.bifacialityFactor,
      tiltRadians: Math.PI / 6,
      gcr: 0.4,
    });
  }

  const panelStats: PanelStat[] = panels.map((pg, i) => ({
    id: i,
    // Use per-panel TSRF override if present (for parity with legacy),
    // otherwise default to 0.85
    tsrf: pg.tsrf ?? 0.85,
    points: pg.shadePointIds,
    panelKey: equipment.panelKey,
    bifacialGain,
  }));

  // 3. Prepare weather (null TMY = synthetic irradiance path)
  const tmyLookup = prepareTmyLookup(null);
  const hasShade = Object.keys(shadeData).length > 0;

  // 4. Run Model A
  const modelA = runModelA(
    { panels: panelStats, shadeData, resolvedPanels, tmyLookup, hasShade },
    reportProgress
  );

  // 5. Run Model B (string architecture only)
  let modelBResult: import('../engine/engine-types').ModelBResult | null = null;
  let mismatchLossPct = 0;

  const architectureType = inverterSpec.architectureType;

  if (architectureType === 'string' && strings.length > 0) {
    const primaryPanelKey = equipment.panelKey;
    modelBResult = runModelB(
      { panels: panelStats, strings, shadeData, resolvedPanels, tmyLookup, hasShade, primaryPanelKey },
      reportProgress
    );
    mismatchLossPct = computeMismatchLoss(modelA.annualKwh, modelBResult.annualKwh, architectureType);
  }

  // 6. Apply system derate
  const systemDerate = getSystemDerate(lossProfile, architectureType);
  const deratedIndependentAnnual = modelA.annualKwh * systemDerate;
  const deratedStringAnnual = modelBResult ? modelBResult.annualKwh * systemDerate : deratedIndependentAnnual;

  // 7. Clipping detection — requires dispatch module (Stage 5)
  // Stage 1: no dispatch, so clipping events are empty
  const clippingEvents: ClippingEvent[] = [];
  const clippingLossPct = 0;

  // 8. Compute system stats
  const systemSizeKw = (panelSpec.watts * panels.length) / 1000;
  let weightedTsrf = 0;
  for (const ps of panelStats) {
    weightedTsrf += panelSpec.watts * (ps.tsrf || 0.8);
  }
  const systemTsrf = weightedTsrf / (panelSpec.watts * panels.length);
  const specificYield = systemSizeKw > 0 ? deratedIndependentAnnual / systemSizeKw : 0;

  // 9. Final progress
  reportProgress({
    type: 'SIMULATION_PROGRESS',
    payload: { percent: 100, stage: 'Complete' },
  });

  return {
    panelStats,
    production: {
      independentAnnual: deratedIndependentAnnual,
      stringLevelAnnual: deratedStringAnnual,
      eagleViewAnnual: 0,
    },
    mismatchLossPct,
    clippingLossPct,
    clippingEvents,
    independentTimeseries: modelA.panelTimeseries,
    stringTimeseries: modelBResult?.stringTimeseries || [],
    shadeFidelity: 'full',
    shadeSource: 'manual',
    panelCount: panels.length,
    systemSizeKw,
    systemTsrf,
    specificYield,
  };
}

/**
 * Canonical adapter: legacy RunnerInput -> CoreSolarDesignerInput.
 * Used by the parity test to ensure both runners see identical data.
 *
 * Injects per-panel TSRF as a non-spec field so the CoreRunner can
 * preserve the exact TSRF values from the legacy fixture.
 */
export function legacyFixtureToCoreInput(legacy: RunnerInput): CoreSolarDesignerInput {
  return {
    panels: legacy.panels.map((p, i) => ({
      id: String(p.id ?? i),
      x: 0,
      y: 0,
      width: 1.02,
      height: 1.82,
      azimuth: 180,
      tilt: 30,
      shadePointIds: p.points || [],
      // Inject TSRF for parity — not part of PanelGeometry spec but the
      // runner reads it via (pg as PanelGeometryWithTsrf).tsrf
      tsrf: p.tsrf,
    })),
    shadeData: legacy.shadeData,
    strings: legacy.strings,
    inverters: legacy.inverters,
    equipment: {
      panelKey: legacy.panels[0]?.panelKey || '',
      inverterKey: Object.keys(legacy.resolvedInverters)[0] || '',
    },
    siteConditions: {
      tempMin: -10,
      tempMax: 45,
      groundAlbedo: legacy.groundAlbedo || 0.2,
      clippingThreshold: legacy.clippingThreshold || 1.0,
      exportLimitW: 0,
    },
    lossProfile: legacy.lossProfile,
  };
}

function emptyResult(): CoreSolarDesignerResult {
  return {
    panelStats: [],
    production: { independentAnnual: 0, stringLevelAnnual: 0, eagleViewAnnual: 0 },
    mismatchLossPct: 0,
    clippingLossPct: 0,
    clippingEvents: [],
    independentTimeseries: [],
    stringTimeseries: [],
    shadeFidelity: 'full',
    shadeSource: 'manual',
    panelCount: 0,
    systemSizeKw: 0,
    systemTsrf: 0,
    specificYield: 0,
  };
}
