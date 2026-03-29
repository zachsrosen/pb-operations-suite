/**
 * Solar Engine — Project-to-Worker Adapter
 *
 * Maps a SolarProject (Prisma JSON fields) → WorkerRunMessage["payload"].
 *
 * Two modes:
 * 1. **Design data present** (stringsConfig populated): full panel-level data
 * 2. **Design data absent** (wizard-only): Quick Estimate — auto-derives
 *    panel count, uniform strings, default TSRF=0.80 [B1]
 *
 * The resulting payload is passed via postMessage to the Web Worker,
 * which runs it through the canonical `mapPayloadToRunnerInput()` [B3].
 */

import type { WorkerRunMessage } from "../types";
import {
  getBuiltInEquipment,
  type BuiltInPanel,
  type BuiltInInverter,
  type BuiltInOptimizer,
  type BuiltInEss,
} from "../equipment-catalog";
import type {
  ResolvedPanel,
  ResolvedInverter,
  ResolvedOptimizer,
  ResolvedEss,
  StringConfig,
  InverterConfig,
} from "../engine/engine-types";

// ── Error Types ─────────────────────────────────────────────

export class DesignDataRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignDataRequired";
  }
}

// ── Output Types ────────────────────────────────────────────

export interface WorkerPayloadResult {
  payload: WorkerRunMessage["payload"];
  isQuickEstimate: boolean;
}

// ── Input shape (from SolarProject Prisma JSON) ─────────────

/** Subset of SolarProject fields needed by the adapter */
export interface ProjectForAdapter {
  equipmentConfig?: Record<string, unknown> | null;
  stringsConfig?: Record<string, unknown> | null;
  panelStats?: Array<Record<string, unknown>> | null;
  lossProfile?: Record<string, unknown> | null;
  siteConditions?: Record<string, unknown> | null;
  homeConsumptionConfig?: Record<string, unknown> | null;
}

export interface WeatherDataForAdapter {
  ghi: number[];
  temperature: number[];
}

// ── Main Builder ────────────────────────────────────────────

/**
 * Build the WorkerRunMessage payload from a SolarProject + weather data.
 *
 * @throws {DesignDataRequired} if panelKey or inverterKey is missing
 */
export function buildWorkerPayload(
  project: ProjectForAdapter,
  weatherData: WeatherDataForAdapter | null
): WorkerPayloadResult {
  const eq = project.equipmentConfig as Record<string, unknown> | null;
  if (!eq) {
    throw new DesignDataRequired(
      "Complete equipment selection before running analysis"
    );
  }

  const panelKey = eq.panelKey as string | undefined;
  const inverterKey = eq.inverterKey as string | undefined;

  if (!panelKey || !inverterKey) {
    throw new DesignDataRequired(
      "Complete equipment selection before running analysis"
    );
  }

  const catalog = getBuiltInEquipment();

  const panel = catalog.panels[panelKey];
  const inverter = catalog.inverters[inverterKey];
  if (!panel || !inverter) {
    throw new DesignDataRequired(
      `Unknown equipment: ${!panel ? `panel "${panelKey}"` : `inverter "${inverterKey}"`}`
    );
  }

  const essKey = (eq.essKey as string) || "None";
  const optimizerKey = eq.optimizerKey as string | null;
  const ess = catalog.ess[essKey] || null;
  const optimizer = optimizerKey ? catalog.optimizers[optimizerKey] || null : null;

  const resolvedPanels = resolvePanel(panelKey, panel);
  const resolvedInverters = resolveInverter(inverterKey, inverter);
  const resolvedOptimizer = optimizer
    ? resolveOptimizer(optimizerKey!, optimizer)
    : null;
  const resolvedEss = ess && ess.type !== "none" ? resolveEss(essKey, ess) : null;

  const hasDesignData = hasFullDesignData(project);
  const shadeData = eq.shadeData as Record<string, unknown> | undefined;
  const hasShadeData = shadeData && Object.keys(shadeData).length > 0;
  // Quick Estimate only when no design data AND no shade data
  const isQuickEstimate = !hasDesignData && !hasShadeData;

  let panelStats: WorkerRunMessage["payload"]["panelStats"];
  let stringsConfig: Record<string, unknown>;

  if (hasDesignData) {
    // Full design data — use as-is
    panelStats = (project.panelStats as WorkerRunMessage["payload"]["panelStats"]) || [];
    stringsConfig = (project.stringsConfig as Record<string, unknown>) || {};
  } else if (hasShadeData) {
    // Shade-informed estimate — use Google Solar API data for panel count + TSRF
    const qe = generateShadeInformedEstimate(
      panel, inverter, panelKey, inverterKey, shadeData!
    );
    panelStats = qe.panelStats;
    stringsConfig = qe.stringsConfig;
  } else {
    // Quick Estimate mode [B1] — no shade, no design
    const qe = generateQuickEstimate(panel, inverter, panelKey, inverterKey);
    panelStats = qe.panelStats;
    stringsConfig = qe.stringsConfig;
  }

  const batteryConfig = buildBatteryConfig(ess, essKey, resolvedEss);

  // Embed batteryConfig into each inverter entry in stringsConfig
  // The engine reads battery config from InverterConfig.batteryConfig,
  // not from a top-level payload field.
  if (batteryConfig) {
    const scInverters = (stringsConfig as any).inverters as any[] | undefined;
    if (scInverters) {
      for (const inv of scInverters) {
        inv.batteryConfig = batteryConfig;
      }
    }
  }

  const payload: WorkerRunMessage["payload"] = {
    weatherData: weatherData || { ghi: [], temperature: [] },
    panelStats,
    equipmentConfig: {
      resolvedPanels: { [panelKey]: resolvedPanels },
      resolvedInverters: { [inverterKey]: resolvedInverters },
      resolvedOptimizer,
      resolvedEss,
      architectureType: inverter.architectureType,
      shadeData: (eq.shadeData as Record<string, string>) || {},
      clippingThreshold: (eq.clippingThreshold as number) ?? 1.0,
    },
    stringsConfig,
    siteConditions: (project.siteConditions as Record<string, unknown>) || {
      groundAlbedo: 0.2,
    },
    lossProfile: (project.lossProfile as Record<string, unknown>) || {},
    ...(project.homeConsumptionConfig
      ? { homeConsumptionConfig: project.homeConsumptionConfig as Record<string, unknown> }
      : {}),
  };

  return { payload, isQuickEstimate };
}

// ── Quick Estimate Generator [B1] ───────────────────────────

interface QuickEstimateResult {
  panelStats: WorkerRunMessage["payload"]["panelStats"];
  stringsConfig: Record<string, unknown>;
}

/**
 * Auto-derive panel count and string assignments when no design data exists.
 * - Panel count = inverter DC max ÷ panel watts, capped at 2× DC/AC ratio
 * - Uniform strings: round-robin panel assignment across inverter channels
 * - All panels get default TSRF=0.80
 */
function generateQuickEstimate(
  panel: BuiltInPanel,
  inverter: BuiltInInverter,
  panelKey: string,
  inverterKey: string
): QuickEstimateResult {
  // Derive panel count from inverter capacity
  const rawCount = Math.round(inverter.dcMax / panel.watts);
  const maxCount = Math.ceil((inverter.acPower * 2) / panel.watts); // cap at 2× DC/AC
  const panelCount = Math.min(rawCount, maxCount);

  if (panelCount === 0) {
    return {
      panelStats: [],
      stringsConfig: { strings: [], inverters: [] },
    };
  }

  // Generate panel stats with default TSRF
  const panelStats: WorkerRunMessage["payload"]["panelStats"] = Array.from(
    { length: panelCount },
    (_, i) => ({
      tsrf: 0.8, // default TSRF — no shade data
      panelKey,
      segmentIndex: 0,
    })
  );

  // Generate uniform strings via round-robin across inverter channels
  const channels = inverter.channels || 1;
  const isMicro = inverter.isMicro || inverter.architectureType === "micro";

  let strings: StringConfig[];
  let inverterConfigs: InverterConfig[];

  if (isMicro) {
    // Micro: each panel is its own "string"
    strings = Array.from({ length: panelCount }, (_, i) => ({
      panels: [i],
    }));
    inverterConfigs = [
      {
        inverterKey,
        stringIndices: strings.map((_, i) => i),
      },
    ];
  } else {
    // String/optimizer: round-robin panels into channels
    const channelBuckets: number[][] = Array.from({ length: channels }, () => []);
    for (let i = 0; i < panelCount; i++) {
      channelBuckets[i % channels].push(i);
    }
    // Filter out empty buckets
    strings = channelBuckets
      .filter((b) => b.length > 0)
      .map((panels) => ({ panels }));
    inverterConfigs = [
      {
        inverterKey,
        stringIndices: strings.map((_, i) => i),
      },
    ];
  }

  return {
    panelStats,
    stringsConfig: {
      strings,
      inverters: inverterConfigs,
    },
  };
}

// ── Shade-Informed Estimate ──────────────────────────────────

/**
 * Use Google Solar API shade data to derive panel count and per-panel TSRF.
 * - Panel count from `maxArrayPanelsCount` (capped by inverter capacity)
 * - Per-panel TSRF from `solarPanels[].yearlyEnergyDcKwh` or
 *   `roofSegments[].stats.sunshineQuantiles`
 * - Falls back to inverter-derived count if shade data is sparse
 */
function generateShadeInformedEstimate(
  panel: BuiltInPanel,
  inverter: BuiltInInverter,
  panelKey: string,
  inverterKey: string,
  shadeData: Record<string, unknown>
): QuickEstimateResult {
  // Extract shade data fields
  const maxArrayPanels = (shadeData.maxArrayPanelsCount as number) || 0;
  const maxSunshineHours = (shadeData.maxSunshineHoursPerYear as number) || 0;
  const solarPanels = (shadeData.solarPanels as Array<Record<string, unknown>>) || [];
  const roofSegments = (shadeData.roofSegments as Array<Record<string, unknown>>) || [];

  // Panel count: use shade data count, but cap by inverter capacity
  const inverterMaxPanels = Math.ceil((inverter.dcMax * 1.5) / panel.watts);
  const panelCount = maxArrayPanels > 0
    ? Math.min(maxArrayPanels, inverterMaxPanels)
    : Math.min(Math.round(inverter.dcMax / panel.watts), inverterMaxPanels);

  if (panelCount === 0) {
    return {
      panelStats: [],
      stringsConfig: { strings: [], inverters: [] },
    };
  }

  // Derive per-panel TSRF from Google Solar API panel data
  // TSRF = panel's sunshine hours / max possible sunshine hours
  // Reference: ~4380 hours = theoretical max (12h × 365d), use maxSunshineHours if available
  const referenceHours = maxSunshineHours > 0 ? maxSunshineHours : 4380;

  const panelStats: WorkerRunMessage["payload"]["panelStats"] = [];

  if (solarPanels.length > 0) {
    // Use individual panel data from Google Solar API
    for (let i = 0; i < panelCount; i++) {
      const sp = solarPanels[i]; // may be undefined if panelCount > solarPanels.length
      let tsrf = 0.8; // default fallback

      if (sp) {
        const yearlyEnergy = sp.yearlyEnergyDcKwh as number | undefined;
        if (yearlyEnergy && yearlyEnergy > 0) {
          // Derive TSRF: actual yield / ideal yield (STC watts × sunshine hours / 1000)
          const idealKwh = (panel.watts * referenceHours) / 1000;
          tsrf = idealKwh > 0 ? Math.min(yearlyEnergy / idealKwh, 1.0) : 0.8;
        }
      }

      // Determine segment index from solar panel data
      const segmentIndex = sp
        ? (sp.segmentIndex as number | undefined) ?? 0
        : 0;

      panelStats.push({ tsrf, panelKey, segmentIndex });
    }
  } else if (roofSegments.length > 0) {
    // Fallback: use roof segment stats to derive average TSRF per segment
    // Distribute panels proportionally across segments
    const totalPanelsInSegments = roofSegments.reduce((sum, seg) => {
      return sum + ((seg.panelsCount as number) || 0);
    }, 0);

    let assigned = 0;
    for (let segIdx = 0; segIdx < roofSegments.length && assigned < panelCount; segIdx++) {
      const seg = roofSegments[segIdx];
      const segPanels = (seg.panelsCount as number) || 0;
      const segStats = seg.stats as Record<string, unknown> | undefined;

      // Derive segment TSRF from sunshine quantiles (median = index 5 of 11)
      let segTsrf = 0.8;
      if (segStats) {
        const quantiles = segStats.sunshineQuantiles as number[] | undefined;
        if (quantiles && quantiles.length > 5) {
          const medianHours = quantiles[5]; // median sunshine
          segTsrf = referenceHours > 0
            ? Math.min(medianHours / referenceHours, 1.0)
            : 0.8;
        }
      }

      // Proportionally allocate panels to this segment
      const segShare = totalPanelsInSegments > 0
        ? Math.round((segPanels / totalPanelsInSegments) * panelCount)
        : Math.ceil(panelCount / roofSegments.length);
      const segCount = Math.min(segShare, panelCount - assigned);

      for (let j = 0; j < segCount; j++) {
        panelStats.push({ tsrf: segTsrf, panelKey, segmentIndex: segIdx });
        assigned++;
      }
    }

    // Fill remaining panels with average TSRF if proportional distribution was short
    while (panelStats.length < panelCount) {
      panelStats.push({ tsrf: 0.8, panelKey, segmentIndex: 0 });
    }
  } else {
    // No per-panel or per-segment data — use whole-roof sunshine for uniform TSRF
    const uniformTsrf = maxSunshineHours > 0
      ? Math.min(maxSunshineHours / 4380, 1.0)
      : 0.8;
    for (let i = 0; i < panelCount; i++) {
      panelStats.push({ tsrf: uniformTsrf, panelKey, segmentIndex: 0 });
    }
  }

  // Generate string assignments (same logic as Quick Estimate)
  const channels = inverter.channels || 1;
  const isMicro = inverter.isMicro || inverter.architectureType === "micro";

  let strings: StringConfig[];
  let inverterConfigs: InverterConfig[];

  if (isMicro) {
    strings = Array.from({ length: panelCount }, (_, i) => ({ panels: [i] }));
    inverterConfigs = [{ inverterKey, stringIndices: strings.map((_, i) => i) }];
  } else {
    const channelBuckets: number[][] = Array.from({ length: channels }, () => []);
    for (let i = 0; i < panelCount; i++) {
      channelBuckets[i % channels].push(i);
    }
    strings = channelBuckets.filter((b) => b.length > 0).map((panels) => ({ panels }));
    inverterConfigs = [{ inverterKey, stringIndices: strings.map((_, i) => i) }];
  }

  return {
    panelStats,
    stringsConfig: { strings, inverters: inverterConfigs },
  };
}

// ── Design Data Detection ───────────────────────────────────

function hasFullDesignData(project: ProjectForAdapter): boolean {
  const sc = project.stringsConfig as Record<string, unknown> | null;
  if (!sc) return false;

  const strings = sc.strings as unknown[];
  if (!Array.isArray(strings) || strings.length === 0) return false;

  const panels = project.panelStats as unknown[];
  if (!Array.isArray(panels) || panels.length === 0) return false;

  return true;
}

// ── Equipment Resolvers ─────────────────────────────────────

function resolvePanel(key: string, p: BuiltInPanel): ResolvedPanel {
  return {
    key,
    name: p.name,
    watts: p.watts,
    voc: p.voc,
    vmp: p.vmp,
    isc: p.isc,
    imp: p.imp,
    tempCoVoc: p.tempCoVoc,
    tempCoIsc: p.tempCoIsc,
    tempCoPmax: p.tempCoPmax,
    cells: p.cells,
    bypassDiodes: p.bypassDiodes,
    cellsPerSubstring: p.cellsPerSubstring,
    isBifacial: p.isBifacial || false,
    bifacialityFactor: p.bifacialityFactor || 0,
  };
}

function resolveInverter(key: string, inv: BuiltInInverter): ResolvedInverter {
  return {
    key,
    name: inv.name,
    acPower: inv.acPower,
    dcMax: inv.dcMax,
    mpptMin: inv.mpptMin,
    mpptMax: inv.mpptMax,
    channels: inv.channels,
    maxIsc: inv.maxIsc,
    efficiency: inv.efficiency,
    architectureType: inv.architectureType,
    isMicro: inv.isMicro || false,
    isIntegrated: inv.isIntegrated || false,
  };
}

function resolveOptimizer(
  key: string,
  opt: BuiltInOptimizer
): ResolvedOptimizer {
  return {
    key,
    name: opt.name,
    dcMaxInput: opt.dcMaxInput,
    inputVoltageMax: opt.inputVoltageMax,
    maxIsc: opt.maxIsc,
    outputVoltageMax: opt.outputVoltageMax,
    maxOutputCurrent: opt.maxOutputCurrent,
    efficiency: opt.efficiency,
  };
}

function resolveEss(key: string, e: BuiltInEss): ResolvedEss {
  return {
    key,
    name: e.name,
    capacity: e.capacity,
    power: e.power,
    roundTrip: e.roundTrip,
    dcChargeRate: e.dcChargeRate,
    type: e.type,
  };
}

// ── Battery Config Builder ──────────────────────────────────

function buildBatteryConfig(
  ess: BuiltInEss | null,
  essKey: string,
  resolvedEss: ResolvedEss | null
): Record<string, unknown> | null {
  if (!ess || ess.type === "none" || !resolvedEss) return null;

  return {
    essKey,
    totalCapacityWh: ess.capacity * 1000,
    totalDcChargeW: ess.dcChargeRate,
    maxDischargeW: ess.power * 1000,
    roundTrip: ess.roundTrip,
  };
}
