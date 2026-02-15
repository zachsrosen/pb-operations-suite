// Shared constants - stage order, stage colors, location colors
// Extracted from page.tsx, executive, locations, at-risk, timeline, command-center, optimizer

/** Canonical stage order for the project pipeline (top = furthest along) */
export const STAGE_ORDER = [
  "Close Out",
  "Permission To Operate",
  "Inspection",
  "Construction",
  "Ready To Build",
  "RTB - Blocked",
  "Permitting & Interconnection",
  "Design & Engineering",
  "Site Survey",
  "Project Rejected - Needs Review",
] as const;

/** Reverse stage order (bottom = furthest along, used by some charts) */
export const STAGE_ORDER_ASC = [...STAGE_ORDER].reverse();

/** Stage colors - both Tailwind class and hex value for flexibility */
export const STAGE_COLORS: Record<string, { tw: string; hex: string }> = {
  "Site Survey": { tw: "bg-blue-500", hex: "#3B82F6" },
  "Design & Engineering": { tw: "bg-indigo-500", hex: "#6366F1" },
  "Permitting & Interconnection": { tw: "bg-purple-500", hex: "#A855F7" },
  "RTB - Blocked": { tw: "bg-red-500", hex: "#EF4444" },
  "Ready To Build": { tw: "bg-yellow-500", hex: "#EAB308" },
  Construction: { tw: "bg-orange-500", hex: "#F97316" },
  Inspection: { tw: "bg-amber-500", hex: "#F59E0B" },
  "Permission To Operate": { tw: "bg-lime-500", hex: "#84CC16" },
  "Close Out": { tw: "bg-green-500", hex: "#22C55E" },
  "Project Complete": { tw: "bg-emerald-500", hex: "#10B981" },
  "Project Rejected - Needs Review": { tw: "bg-zinc-500", hex: "#71717A" },
};

/** Location colors for charts and visualizations */
export const LOCATION_COLORS: Record<string, { tw: string; hex: string }> = {
  Westminster: { tw: "bg-blue-500", hex: "#3B82F6" },
  Centennial: { tw: "bg-emerald-500", hex: "#10B981" },
  "Colorado Springs": { tw: "bg-amber-500", hex: "#F59E0B" },
  "San Luis Obispo": { tw: "bg-violet-500", hex: "#8B5CF6" },
  Camarillo: { tw: "bg-pink-500", hex: "#EC4899" },
  Unknown: { tw: "bg-zinc-500", hex: "#71717A" },
};

/** Ordered list of location color classes for dynamic assignment */
export const LOCATION_COLOR_CLASSES = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-purple-500",
  "bg-zinc-500",
  "bg-pink-500",
  "bg-cyan-500",
];

/**
 * Mapping of office/service locations to IANA timezones.
 * Used for timezone-aware scheduling (Zuper API, crew availability, schedulers).
 */
export const LOCATION_TIMEZONES: Record<string, string> = {
  Westminster: "America/Denver",
  Centennial: "America/Denver",
  DTC: "America/Denver",
  "Colorado Springs": "America/Denver",
  "San Luis Obispo": "America/Los_Angeles",
  Camarillo: "America/Los_Angeles",
};

/** Default timezone when location is unknown or unmapped. */
export const DEFAULT_TIMEZONE = "America/Denver";

/** Look up the timezone for a location, falling back to DEFAULT_TIMEZONE. */
export function getTimezoneForLocation(location: string): string {
  return LOCATION_TIMEZONES[location] || DEFAULT_TIMEZONE;
}

/** Sales pipeline stages */
export const SALES_STAGES: string[] = [
  "Qualified to buy",
  "Proposal Submitted",
  "Proposal Accepted",
  "Finalizing Deal",
  "Sales Follow Up",
  "Nurture",
  "Closed won",
  "Closed lost",
];

/** Active (non-closed) sales stages */
export const ACTIVE_SALES_STAGES: string[] = [
  "Qualified to buy",
  "Proposal Submitted",
  "Proposal Accepted",
  "Finalizing Deal",
  "Sales Follow Up",
  "Nurture",
];

/** D&R pipeline stages */
export const DNR_STAGES: string[] = [
  "Kickoff",
  "Site Survey",
  "Design",
  "Permit",
  "Ready for Detach",
  "Detach",
  "Detach Complete - Roofing In Progress",
  "Reset Blocked - Waiting on Payment",
  "Ready for Reset",
  "Reset",
  "Inspection",
  "Closeout",
  "Complete",
  "On-hold",
  "Cancelled",
];

/** Service pipeline stages */
export const SERVICE_STAGES: string[] = [
  "Project Preparation",
  "Site Visit Scheduling",
  "Work In Progress",
  "Inspection",
  "Invoicing",
  "Completed",
  "Cancelled",
];
