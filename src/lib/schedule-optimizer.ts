import { getBusinessEndDateInclusive } from "./business-days";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OptimizableProject {
  id: string;
  name: string;
  address: string;
  location: string; // "Westminster", "Centennial", etc.
  amount: number;
  stage: string; // normalized: "rtb" (scheduler uses this, NOT "Ready To Build")
  isPE: boolean;
  daysInstall: number;
  daysToInstall: number | null; // days until install deadline (negative = overdue)
}

export type ScoringPreset =
  | "balanced"
  | "revenue-first"
  | "pe-priority"
  | "urgency-first";

export interface OptimizedEntry {
  project: OptimizableProject;
  crew: string; // e.g. "WESTY Alpha"
  crewColor: string;
  startDate: string; // YYYY-MM-DD
  days: number;
  score: number;
  assigneeName: string;
  assigneeUserUid: string;
  assigneeTeamUid: string;
  timezone: string;
}

interface CrewConfig {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
}

interface DirectorConfig {
  name: string;
  userUid: string;
  teamUid: string;
}

interface GenerateOptions {
  preset?: ScoringPreset;
  startDate?: string; // YYYY-MM-DD, defaults to next business day after today
}

/* ------------------------------------------------------------------ */
/*  Scoring                                                            */
/* ------------------------------------------------------------------ */

const PRESET_WEIGHTS: Record<
  ScoringPreset,
  { revenue: number; pe: number; urgency: number }
> = {
  balanced: { revenue: 1, pe: 1, urgency: 1 },
  "revenue-first": { revenue: 3, pe: 0.5, urgency: 0.5 },
  "pe-priority": { revenue: 0.5, pe: 3, urgency: 1.5 },
  "urgency-first": { revenue: 0.5, pe: 1, urgency: 3 },
};

export function calculatePriorityScore(
  project: OptimizableProject,
  preset: ScoringPreset = "balanced"
): number {
  const w = PRESET_WEIGHTS[preset];

  // Revenue component (0–100)
  const revenue = Math.min(100, (project.amount || 0) / 1000);

  // PE bonus
  const peBonus = project.isPE ? 50 : 0;

  // Urgency from days-to-install deadline
  let urgency = 0;
  const dti = project.daysToInstall;
  if (dti !== null && dti !== undefined) {
    if (dti < 0) {
      urgency = Math.min(200, Math.abs(dti) * 2);
    } else if (dti <= 14) {
      urgency = (14 - dti) * 3;
    }
  }

  // RTB bonus (all input should be RTB, but guard anyway)
  const rtbBonus = 30;

  const score =
    revenue * w.revenue +
    peBonus * w.pe +
    urgency * w.urgency +
    rtbBonus;

  return Math.max(0, score);
}

/* ------------------------------------------------------------------ */
/*  Date Helpers                                                       */
/* ------------------------------------------------------------------ */

function parseYmdToUtcDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateToYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Returns the next business day strictly after the given date. */
export function nextBusinessDayAfter(dateStr: string): string {
  const cursor = parseYmdToUtcDate(dateStr);
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return formatUtcDateToYmd(cursor);
}

/** Returns the next business day after today (gives time for review before schedule starts). */
function getDefaultStartDate(): string {
  const now = new Date();
  const today = formatUtcDateToYmd(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  );
  return nextBusinessDayAfter(today);
}

/* ------------------------------------------------------------------ */
/*  Schedule Generation                                                */
/* ------------------------------------------------------------------ */

export function generateOptimizedSchedule(
  projects: OptimizableProject[],
  crews: Record<string, CrewConfig[]>,
  directors: Record<string, DirectorConfig>,
  timezones: Record<string, string>,
  options: GenerateOptions = {}
): { entries: OptimizedEntry[]; skipped: OptimizableProject[] } {
  const preset = options.preset || "balanced";
  const startDate = options.startDate || getDefaultStartDate();
  const defaultTimezone = "America/Denver";

  if (projects.length === 0) {
    return { entries: [], skipped: [] };
  }

  // Score and sort by priority (descending)
  const scored = projects.map((p) => ({
    project: p,
    score: calculatePriorityScore(p, preset),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Initialize crew next-available dates
  const crewNextDate: Record<string, string> = {};
  for (const [, locationCrews] of Object.entries(crews)) {
    for (const crew of locationCrews) {
      crewNextDate[crew.name] = startDate;
    }
  }

  const entries: OptimizedEntry[] = [];
  const skipped: OptimizableProject[] = [];

  for (const { project, score } of scored) {
    const locationCrews = crews[project.location];
    const director = directors[project.location];

    // Skip if location has no crews or no director
    if (!locationCrews || locationCrews.length === 0 || !director) {
      skipped.push(project);
      continue;
    }

    // Find the crew with the earliest next-available date
    let bestCrew = locationCrews[0];
    let bestDate = crewNextDate[bestCrew.name] || startDate;

    for (let i = 1; i < locationCrews.length; i++) {
      const crew = locationCrews[i];
      const nextDate = crewNextDate[crew.name] || startDate;
      if (nextDate < bestDate) {
        bestCrew = crew;
        bestDate = nextDate;
      }
    }

    const jobStartDate = bestDate;
    const days = Math.max(1, Math.ceil(project.daysInstall));
    const endDateInclusive = getBusinessEndDateInclusive(jobStartDate, days);

    // Next available = next business day AFTER the inclusive end date
    crewNextDate[bestCrew.name] = nextBusinessDayAfter(endDateInclusive);

    entries.push({
      project,
      crew: bestCrew.name,
      crewColor: bestCrew.color,
      startDate: jobStartDate,
      days,
      score,
      assigneeName: director.name,
      assigneeUserUid: director.userUid,
      assigneeTeamUid: director.teamUid,
      timezone: timezones[project.location] || defaultTimezone,
    });
  }

  return { entries, skipped };
}
