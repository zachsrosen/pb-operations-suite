/**
 * Clipping Detection Engine
 *
 * Seasonal TSRF decomposition: when shade data is unavailable (EVTD-only designs),
 * the annual-average TSRF suppresses summer peaks. This decomposes TSRF into a
 * seasonal curve so we can estimate true summer peak DC/AC ratio and flag clipping.
 */

export interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

export interface ClippingAnalysis {
  projectName: string;
  projectId: string;
  projectUrl?: string;
  panelCount: number;
  panelWattage: number;
  dcCapacityKw: number;
  inverterCount: number;
  inverterModel: string;
  acCapacityKw: number;
  nameplateDcAcRatio: number;
  estimatedSummerDcAcRatio: number;
  estimatedSummerTsrf: number;
  avgTsrf: number;
  batteryCount: number;
  batteryKwh: number;
  riskLevel: "none" | "low" | "moderate" | "high";
  stage: string;
  designStatus?: string;
  closeDate?: string;
  amount?: number;
}

/** Default annual avg TSRF when not known (typical residential) */
export const DEFAULT_TSRF = 0.84;

/** Fraction of shade loss recovered in summer */
const SHADE_SWING_FACTOR = 0.65;

export function getSeasonalTSRF(annualTsrf: number): number {
  if (annualTsrf >= 1.0) return annualTsrf;
  const B = SHADE_SWING_FACTOR * (1.0 - annualTsrf);
  const correctedBase = annualTsrf - 0.15 * B;
  return Math.min(1.0, correctedBase + B);
}

/**
 * Analyze a project for clipping risk based on equipment data.
 * Requires a project-like object with at least: id, name, url, stage, equipment.
 */
export function analyzeClipping(project: {
  id: string;
  name: string;
  url?: string;
  stage: string;
  designStatus?: string;
  closeDate?: string;
  amount?: number;
  equipment?: FullEquipment | { modules?: { count: number; wattage: number }; inverter?: { count: number } };
}): ClippingAnalysis | null {
  const eq = project.equipment as FullEquipment | undefined;
  if (!eq) return null;

  const panelCount = eq.modules?.count || 0;
  const panelWattage = eq.modules?.wattage || 0;
  const inverterCount = eq.inverter?.count || 0;
  const inverterSizeKwac = eq.inverter?.sizeKwac || 0;
  const inverterModel = eq.inverter?.model || "Unknown";

  const dcCapacityKw = eq.systemSizeKwdc || (panelCount * panelWattage / 1000);
  const acCapacityKw = eq.systemSizeKwac || (inverterCount * inverterSizeKwac);

  if (dcCapacityKw <= 0 || acCapacityKw <= 0) return null;

  const nameplateDcAcRatio = dcCapacityKw / acCapacityKw;
  const avgTsrf = DEFAULT_TSRF;
  const summerTsrf = getSeasonalTSRF(avgTsrf);
  const estimatedSummerDcAcRatio = (dcCapacityKw * summerTsrf) / acCapacityKw;

  const batteryCount = eq.battery?.count || 0;
  const batteryKwh = batteryCount * (eq.battery?.sizeKwh || 0);

  // Risk classification
  let riskLevel: ClippingAnalysis["riskLevel"] = "none";
  if (nameplateDcAcRatio > 1.5) {
    riskLevel = "high";
  } else if (estimatedSummerDcAcRatio > 1.15 || nameplateDcAcRatio > 1.3) {
    riskLevel = "moderate";
  } else if (estimatedSummerDcAcRatio > 1.0 || nameplateDcAcRatio > 1.15) {
    riskLevel = "low";
  }

  // Battery can absorb some DC excess — reduce risk if battery present
  if (riskLevel !== "none" && batteryKwh > 0) {
    if (riskLevel === "low") riskLevel = "none";
    else if (riskLevel === "moderate" && nameplateDcAcRatio < 1.4) riskLevel = "low";
  }

  return {
    projectName: project.name,
    projectId: project.id,
    projectUrl: project.url,
    panelCount,
    panelWattage,
    dcCapacityKw,
    inverterCount,
    inverterModel,
    acCapacityKw,
    nameplateDcAcRatio,
    estimatedSummerDcAcRatio,
    estimatedSummerTsrf: summerTsrf,
    avgTsrf,
    batteryCount,
    batteryKwh,
    riskLevel,
    stage: project.stage,
    designStatus: project.designStatus,
    closeDate: project.closeDate,
    amount: project.amount,
  };
}
