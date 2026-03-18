/**
 * Shared forecast ghost generation logic.
 *
 * Used by the forecast schedule page (/dashboards/forecast-schedule).
 * The main scheduler (scheduler/page.tsx) keeps its own inline builder
 * for now — migration is a future follow-up.
 */

// ── Types ──────────────────────────────────────────────────────

export interface TimelineMilestone {
  key: string;
  liveForecast: string | null;
  basis: string;
  varianceDays: number | null;
  name: string;
}

export interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  milestones: TimelineMilestone[];
}

export interface RawProjectMinimal {
  id: string;
  name: string;
  stage: string;
  amount?: number;
  pbLocation?: string;
  city?: string;
  address?: string;
  projectType?: string;
  constructionScheduleDate?: string;
  siteSurveyScheduleDate?: string;
  siteSurveyCompletionDate?: string;
  isParticipateEnergy?: boolean;
  url?: string;
  ahj?: string;
  utility?: string;
  expectedDaysForInstall?: number;
  daysToInstall?: number | null;
  daysForElectricians?: number;
  roofersCount?: number;
  electriciansCount?: number;
  installDifficulty?: number;
  installNotes?: string;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number; brand?: string; model?: string; wattage?: number };
    inverter?: { count?: number; brand?: string; model?: string; sizeKwac?: number };
    battery?: { count?: number; expansionCount?: number; sizeKwh?: number; brand?: string };
    evCount?: number;
  };
}

export interface ForecastGhost {
  id: string;
  name: string;
  date: string;
  stage: string;
  location: string;
  amount: number;
  isForecast: true;
  eventType: "construction";
  days: number;
  address: string;
  type: string;
  systemSize: number;
  moduleCount: number;
  inverterCount: number;
  batteries: number;
  ahj: string;
  utility: string;
  hubspotUrl: string;
  isPE: boolean;
  installNotes: string;
  difficulty: number;
}

// ── Stage helpers ──────────────────────────────────────────────

const STAGE_MAP: Record<string, string> = {
  "Site Survey": "survey",
  "Ready To Build": "rtb",
  "RTB - Blocked": "blocked",
  Construction: "construction",
  Inspection: "inspection",
};

export function mapStage(stageRaw?: string | null): string {
  const stage = (stageRaw || "").trim();
  if (!stage) return "other";
  const direct = STAGE_MAP[stage];
  if (direct) return direct;
  const normalized = stage.toLowerCase();
  if (normalized === "site survey" || normalized === "survey") return "survey";
  if (normalized === "ready to build" || normalized === "rtb") return "rtb";
  if (normalized === "rtb - blocked" || normalized === "blocked") return "blocked";
  if (normalized === "construction") return "construction";
  if (normalized === "inspection") return "inspection";
  return "other";
}

/** Extended stage mapping for D&E / P&I raw stages */
export function mapRawStage(stageRaw: string): string {
  const s = (stageRaw || "").toLowerCase();
  if (s.includes("design") || s.includes("d&e") || s.includes("engineering")) return "design";
  if (s.includes("permit") || s.includes("interconnection") || s.includes("p&i")) return "permitting";
  return mapStage(stageRaw);
}

export const PRE_CONSTRUCTION_STAGES = new Set(["survey", "rtb", "blocked", "design", "permitting"]);

export function normalizeLocation(location?: string | null): string {
  const value = (location || "").trim();
  if (!value) return "Unknown";
  if (value === "DTC") return "Centennial";
  return value;
}

// ── Builder ────────────────────────────────────────────────────

export interface BuildForecastGhostsInput {
  timelineProjects: TimelineProject[];
  rawProjects: RawProjectMinimal[];
  /** Set of project IDs that have real construction/construction-complete events */
  scheduledEventIds: Set<string>;
  /** Set of project IDs with manual installation schedules */
  manualInstallationIds: Set<string>;
}

export function buildForecastGhosts(input: BuildForecastGhostsInput): ForecastGhost[] {
  const { timelineProjects, rawProjects, scheduledEventIds, manualInstallationIds } = input;
  const ghosts: ForecastGhost[] = [];

  for (const tp of timelineProjects) {
    const raw = rawProjects.find((r) => String(r.id) === tp.dealId);
    if (!raw) continue;

    const stage = mapRawStage(raw.stage);

    // Eligibility filter
    if (!PRE_CONSTRUCTION_STAGES.has(stage)) continue;
    if (raw.constructionScheduleDate) continue;
    if (manualInstallationIds.has(String(raw.id))) continue;
    if (scheduledEventIds.has(String(raw.id))) continue;

    const installMilestone = tp.milestones.find(
      (m) => m.key === "install" && m.basis !== "actual" && m.basis !== "insufficient"
    );
    if (!installMilestone?.liveForecast) continue;

    ghosts.push({
      id: String(raw.id),
      name: raw.name,
      date: installMilestone.liveForecast,
      stage,
      location: normalizeLocation(raw.pbLocation || raw.city),
      amount: raw.amount || 0,
      isForecast: true,
      eventType: "construction",
      days: raw.expectedDaysForInstall || raw.daysToInstall || 3,
      address: raw.address || "",
      type: raw.projectType || "Solar",
      systemSize: raw.equipment?.systemSizeKwdc || 0,
      moduleCount: raw.equipment?.modules?.count || 0,
      inverterCount: raw.equipment?.inverter?.count || 0,
      batteries: raw.equipment?.battery?.count || 0,
      ahj: raw.ahj || "",
      utility: raw.utility || "",
      hubspotUrl: raw.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${raw.id}`,
      isPE: raw.isParticipateEnergy || false,
      installNotes: raw.installNotes || "",
      difficulty: raw.installDifficulty || 3,
    });
  }

  return ghosts;
}
