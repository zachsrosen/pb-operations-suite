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

export interface ExistingBooking {
  location: string;   // Location name, e.g. "Westminster"
  startDate: string;  // YYYY-MM-DD
  days: number;       // Business days
}

/** Max jobs per day per location. Locations not listed default to 1. */
export const DEFAULT_LOCATION_CAPACITY: Record<string, number> = {
  Westminster: 2,
  Centennial: 2,
  "Colorado Springs": 1,
  "San Luis Obispo": 2,
  Camarillo: 1,
};

interface GenerateOptions {
  preset?: ScoringPreset;
  startDate?: string; // YYYY-MM-DD, defaults to next business day after today
  existingBookings?: ExistingBooking[];
  locationCapacity?: Record<string, number>; // override default capacity per location
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
  const capacity = options.locationCapacity || DEFAULT_LOCATION_CAPACITY;

  if (projects.length === 0) {
    return { entries: [], skipped: [] };
  }

  // Score and sort by priority (descending)
  const scored = projects.map((p) => ({
    project: p,
    score: calculatePriorityScore(p, preset),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Per-location daily job count: location → date → count
  const locationDayCount: Record<string, Record<string, number>> = {};

  /** Get current job count for a location on a specific date */
  function getDayCount(location: string, dateStr: string): number {
    return locationDayCount[location]?.[dateStr] || 0;
  }

  /** Get the daily capacity for a location (defaults to 1 if not configured) */
  function getCapacity(location: string): number {
    return capacity[location] ?? 1;
  }

  // Seed counts from existing bookings
  if (options.existingBookings) {
    for (const booking of options.existingBookings) {
      const loc = booking.location;
      if (!locationDayCount[loc]) locationDayCount[loc] = {};
      const endDate = getBusinessEndDateInclusive(booking.startDate, booking.days);
      const cursor = parseYmdToUtcDate(booking.startDate);
      const end = parseYmdToUtcDate(endDate);
      while (cursor <= end) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) {
          const ds = formatUtcDateToYmd(cursor);
          locationDayCount[loc][ds] = (locationDayCount[loc][ds] || 0) + 1;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
  }

  /** Check if a job spanning `days` business days starting at `dateStr` exceeds capacity */
  function hasCapacityConflict(location: string, dateStr: string, days: number): boolean {
    const cap = getCapacity(location);
    const endDate = getBusinessEndDateInclusive(dateStr, days);
    const cursor = parseYmdToUtcDate(dateStr);
    const end = parseYmdToUtcDate(endDate);
    while (cursor <= end) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        if (getDayCount(location, formatUtcDateToYmd(cursor)) >= cap) {
          return true;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return false;
  }

  /** Find earliest date from `fromDate` where all business days in span have capacity */
  function findNextAvailableDate(location: string, fromDate: string, days: number): string {
    let candidate = fromDate;
    for (let i = 0; i < 365; i++) {
      if (!hasCapacityConflict(location, candidate, days)) return candidate;
      candidate = nextBusinessDayAfter(candidate);
    }
    return candidate; // fallback
  }

  /** Increment job count for each business day in the span */
  function addJobCounts(location: string, jobStart: string, days: number): void {
    if (!locationDayCount[location]) locationDayCount[location] = {};
    const endInc = getBusinessEndDateInclusive(jobStart, days);
    const c = parseYmdToUtcDate(jobStart);
    const e = parseYmdToUtcDate(endInc);
    while (c <= e) {
      if (c.getUTCDay() !== 0 && c.getUTCDay() !== 6) {
        const ds = formatUtcDateToYmd(c);
        locationDayCount[location][ds] = (locationDayCount[location][ds] || 0) + 1;
      }
      c.setUTCDate(c.getUTCDate() + 1);
    }
  }

  // Track crew round-robin index per location
  const crewRotation: Record<string, number> = {};

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

    const days = Math.max(1, Math.ceil(project.daysInstall));

    // Find earliest date with capacity at this location
    const jobStartDate = findNextAvailableDate(project.location, startDate, days);

    // Increment daily counts for this assignment
    addJobCounts(project.location, jobStartDate, days);

    // Round-robin crew assignment within the location
    const rotIdx = crewRotation[project.location] || 0;
    const assignedCrew = locationCrews[rotIdx % locationCrews.length];
    crewRotation[project.location] = rotIdx + 1;

    entries.push({
      project,
      crew: assignedCrew.name,
      crewColor: assignedCrew.color,
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
