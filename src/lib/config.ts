// Centralized configuration for PB Operations Suite
// All hardcoded data should be defined here as the single source of truth

// =============================================================================
// PIPELINE CONFIGURATION
// =============================================================================

export const PIPELINES = {
  project: {
    id: "6900017",
    name: "Project Pipeline",
    description: "Main solar installation project pipeline",
  },
  sales: {
    id: "default",
    name: "Sales Pipeline",
    description: "Sales deals and proposals",
  },
  dnr: {
    id: "21997330",
    name: "D&R Pipeline",
    description: "Detach & Reset projects",
  },
  service: {
    id: "23928924",
    name: "Service Pipeline",
    description: "Service and maintenance jobs",
  },
  roofing: {
    id: "765928545",
    name: "Roofing Pipeline",
    description: "Roofing projects",
  },
} as const;

export type PipelineKey = keyof typeof PIPELINES;

// =============================================================================
// STAGE CONFIGURATION
// =============================================================================

// Project Pipeline stages with IDs
export const PROJECT_STAGES = {
  "20461935": { name: "Project Rejected - Needs Review", priority: 0, color: "zinc", active: false },
  "20461936": { name: "Site Survey", priority: 1, color: "blue", active: true },
  "20461937": { name: "Design & Engineering", priority: 2, color: "indigo", active: true },
  "20461938": { name: "Permitting & Interconnection", priority: 3, color: "purple", active: true },
  "71052436": { name: "RTB - Blocked", priority: 4, color: "red", active: true },
  "22580871": { name: "Ready To Build", priority: 5, color: "yellow", active: true },
  "20440342": { name: "Construction", priority: 6, color: "orange", active: true },
  "22580872": { name: "Inspection", priority: 7, color: "amber", active: true },
  "20461940": { name: "Permission To Operate", priority: 8, color: "lime", active: true },
  "24743347": { name: "Close Out", priority: 9, color: "green", active: true },
  "20440343": { name: "Project Complete", priority: 10, color: "emerald", active: false },
  "20440344": { name: "On-Hold", priority: -1, color: "zinc", active: false },
  "68229433": { name: "Cancelled", priority: -2, color: "zinc", active: false },
} as const;

// Stage name to ID mapping (derived from above)
export const STAGE_NAME_TO_ID: Record<string, string> = Object.entries(PROJECT_STAGES).reduce(
  (acc, [id, stage]) => ({ ...acc, [stage.name]: id }),
  {}
);

// Stage ID to name mapping
export const STAGE_ID_TO_NAME: Record<string, string> = Object.entries(PROJECT_STAGES).reduce(
  (acc, [id, stage]) => ({ ...acc, [id]: stage.name }),
  {}
);

// Stages that can be scheduled for construction
export const SCHEDULABLE_STAGES = [
  "Site Survey",
  "Ready To Build",
  "RTB - Blocked",
  "Construction",
  "Inspection",
] as const;

// Active stages (not completed, on-hold, or cancelled)
export const ACTIVE_STAGES = Object.entries(PROJECT_STAGES)
  .filter(([, stage]) => stage.active)
  .map(([, stage]) => stage.name);

// Stage display order (for UI rendering)
export const STAGE_DISPLAY_ORDER = [
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

// =============================================================================
// SALES PIPELINE STAGES
// =============================================================================

export const SALES_STAGES = {
  appointmentscheduled: { name: "Appointment Scheduled", priority: 1 },
  qualifiedtobuy: { name: "Qualified to Buy", priority: 2 },
  presentationscheduled: { name: "Presentation Scheduled", priority: 3 },
  decisionmakerboughtin: { name: "Decision Maker Bought-In", priority: 4 },
  contractsent: { name: "Contract Sent", priority: 5 },
  closedwon: { name: "Closed Won", priority: 6 },
  closedlost: { name: "Closed Lost", priority: 0 },
  ofac_compliance_check: { name: "OFAC Compliance Check", priority: 7 },
} as const;

// =============================================================================
// DNR PIPELINE STAGES
// =============================================================================

export const DNR_STAGES = {
  "65765553": { name: "Inspection" },
  "65765554": { name: "On-Hold" },
  "62527040": { name: "Close Out" },
  "62527041": { name: "Cancelled" },
  "62503952": { name: "Ready to Build" },
  "62503953": { name: "Construction" },
  "62527042": { name: "Completed" },
  "66428447": { name: "Permitting" },
  "62527043": { name: "Lost" },
  "90655688": { name: "Scheduling" },
  "66428446": { name: "Design & Engineering" },
  "70135424": { name: "RTB-Blocked" },
  "62503949": { name: "Pending" },
  "62503950": { name: "Site Survey" },
  "62503951": { name: "Proposal" },
  "70143315": { name: "RTB-PTO" },
} as const;

// =============================================================================
// SERVICE PIPELINE STAGES
// =============================================================================

export const SERVICE_STAGES = {
  "58740890": { name: "Pending" },
  "58740891": { name: "Scheduled" },
  "58740892": { name: "In Progress" },
  "58740893": { name: "Completed" },
  "62503954": { name: "On-Hold" },
  "62503955": { name: "Cancelled" },
  "66428448": { name: "Invoiced" },
} as const;

// =============================================================================
// ROOFING PIPELINE STAGES
// =============================================================================

export const ROOFING_STAGES = {
  "765928546": { name: "New Lead" },
  "765928547": { name: "Site Survey" },
  "765928548": { name: "Proposal" },
  "765928549": { name: "Contract Sent" },
  "765928550": { name: "Permitting" },
  "765928551": { name: "Scheduled" },
  "765928552": { name: "In Progress" },
  "765928553": { name: "Inspection" },
  "765928554": { name: "Completed" },
  "765928555": { name: "Lost" },
} as const;

// =============================================================================
// LOCATION CONFIGURATION
// =============================================================================

export const LOCATIONS = {
  Westminster: {
    id: "westminster",
    name: "Westminster",
    shortName: "WM",
    state: "CO",
    timezone: "America/Denver",
  },
  Centennial: {
    id: "centennial",
    name: "Centennial",
    shortName: "CENT",
    state: "CO",
    timezone: "America/Denver",
  },
  "Colorado Springs": {
    id: "colorado-springs",
    name: "Colorado Springs",
    shortName: "COS",
    state: "CO",
    timezone: "America/Denver",
  },
  "San Luis Obispo": {
    id: "san-luis-obispo",
    name: "San Luis Obispo",
    shortName: "SLO",
    state: "CA",
    timezone: "America/Los_Angeles",
  },
  Camarillo: {
    id: "camarillo",
    name: "Camarillo",
    shortName: "CAM",
    state: "CA",
    timezone: "America/Los_Angeles",
  },
} as const;

export type LocationKey = keyof typeof LOCATIONS;

// =============================================================================
// CREW CONFIGURATION
// =============================================================================

export interface Crew {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
  dailyCapacity: number;
}

export interface LocationCrews {
  crews: Crew[];
  monthlyCapacity: number;
}

export const CREWS_BY_LOCATION: Record<LocationKey, LocationCrews> = {
  Westminster: {
    crews: [
      { name: "WM Crew 1", roofers: 2, electricians: 1, color: "#3b82f6", dailyCapacity: 1 },
      { name: "WM Crew 2", roofers: 2, electricians: 1, color: "#8b5cf6", dailyCapacity: 1 },
    ],
    monthlyCapacity: 44,
  },
  Centennial: {
    crews: [
      { name: "CENT Crew", roofers: 2, electricians: 1, color: "#22c55e", dailyCapacity: 1 },
    ],
    monthlyCapacity: 22,
  },
  "Colorado Springs": {
    crews: [
      { name: "COS Crew", roofers: 2, electricians: 1, color: "#eab308", dailyCapacity: 1 },
    ],
    monthlyCapacity: 22,
  },
  "San Luis Obispo": {
    crews: [
      { name: "SLO Solar", roofers: 2, electricians: 1, color: "#06b6d4", dailyCapacity: 1 },
      { name: "SLO Electrical 1", roofers: 0, electricians: 2, color: "#a855f7", dailyCapacity: 1 },
      { name: "SLO Electrical 2", roofers: 0, electricians: 2, color: "#14b8a6", dailyCapacity: 1 },
    ],
    monthlyCapacity: 66,
  },
  Camarillo: {
    crews: [
      { name: "CAM Crew", roofers: 2, electricians: 1, color: "#f43f5e", dailyCapacity: 1 },
    ],
    monthlyCapacity: 22,
  },
};

// =============================================================================
// FORECAST DEFAULTS
// =============================================================================

export const FORECAST_DEFAULTS = {
  // Days after close date for default forecasts when no explicit date is set
  installDaysAfterClose: 90,
  inspectionDaysAfterClose: 120,
  ptoDaysAfterClose: 150,

  // Default days for installation work
  defaultInstallDays: 2,
  defaultElectricianDays: 1,
} as const;

// =============================================================================
// CACHE SETTINGS
// =============================================================================

export const CACHE_SETTINGS = {
  // Time-to-live for API caches in milliseconds
  projectsTTL: 5 * 60 * 1000, // 5 minutes
  dealsTTL: 5 * 60 * 1000, // 5 minutes
  statsTTL: 5 * 60 * 1000, // 5 minutes

  // Auto-refresh interval for dashboards in milliseconds
  dashboardRefreshInterval: 5 * 60 * 1000, // 5 minutes
} as const;

// =============================================================================
// HUBSPOT CONFIGURATION
// =============================================================================

export const HUBSPOT_CONFIG = {
  defaultPortalId: "21710069",
  projectPipelineId: "6900017",
} as const;

// =============================================================================
// DASHBOARD NAVIGATION
// =============================================================================

export interface DashboardConfig {
  id: string;
  title: string;
  description: string;
  path: string;
  tag: string;
  tagColor: "orange" | "purple" | "blue" | "red" | "emerald" | "green" | "cyan";
  category: "operations" | "pipelines" | "leadership" | "api";
}

export const DASHBOARDS: DashboardConfig[] = [
  // Operations Dashboards
  {
    id: "command-center",
    title: "Command Center",
    description: "Pipeline overview, scheduling, PE tracking, revenue, and alerts in one view",
    path: "/command-center",
    tag: "PRIMARY",
    tagColor: "orange",
    category: "operations",
  },
  {
    id: "optimizer",
    title: "Pipeline Optimizer",
    description: "AI-powered scheduling optimization and bottleneck detection",
    path: "/optimizer",
    tag: "ANALYTICS",
    tagColor: "purple",
    category: "operations",
  },
  {
    id: "scheduler",
    title: "Master Scheduler",
    description: "Drag-and-drop scheduling calendar with crew management",
    path: "/scheduler",
    tag: "SCHEDULING",
    tagColor: "blue",
    category: "operations",
  },
  {
    id: "at-risk",
    title: "At-Risk Projects",
    description: "Critical alerts for overdue projects by severity and revenue impact",
    path: "/at-risk",
    tag: "ALERTS",
    tagColor: "red",
    category: "operations",
  },
  {
    id: "locations",
    title: "Location Comparison",
    description: "Performance metrics and project distribution across all locations",
    path: "/locations",
    tag: "ANALYTICS",
    tagColor: "purple",
    category: "operations",
  },
  {
    id: "timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones",
    path: "/timeline",
    tag: "PLANNING",
    tagColor: "blue",
    category: "operations",
  },
  // Other Pipelines
  {
    id: "sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking",
    path: "/sales",
    tag: "SALES",
    tagColor: "green",
    category: "pipelines",
  },
  {
    id: "service",
    title: "Service Pipeline",
    description: "Service jobs, scheduling, and work in progress tracking",
    path: "/service",
    tag: "SERVICE",
    tagColor: "cyan",
    category: "pipelines",
  },
  {
    id: "dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset projects with phase tracking",
    path: "/dnr",
    tag: "D&R",
    tagColor: "purple",
    category: "pipelines",
  },
  // Leadership & PE
  {
    id: "pe",
    title: "PE Dashboard",
    description: "Dedicated PE tracking with milestone status and compliance monitoring",
    path: "/pe",
    tag: "PE",
    tagColor: "emerald",
    category: "leadership",
  },
  {
    id: "executive",
    title: "Executive Summary",
    description: "High-level KPIs, charts, and trends for leadership review",
    path: "/executive",
    tag: "LEADERSHIP",
    tagColor: "purple",
    category: "leadership",
  },
  {
    id: "mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams with quick project lookup",
    path: "/mobile",
    tag: "MOBILE",
    tagColor: "blue",
    category: "leadership",
  },
];

// Helper to get dashboards by category
export function getDashboardsByCategory(category: DashboardConfig["category"]): DashboardConfig[] {
  return DASHBOARDS.filter((d) => d.category === category);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get stage color class for Tailwind
 */
export function getStageColorClass(stageName: string): string {
  const stageEntry = Object.values(PROJECT_STAGES).find((s) => s.name === stageName);
  if (!stageEntry) return "bg-zinc-600";

  const colorMap: Record<string, string> = {
    blue: "bg-blue-500",
    indigo: "bg-indigo-500",
    purple: "bg-purple-500",
    red: "bg-red-500",
    yellow: "bg-yellow-500",
    orange: "bg-orange-500",
    amber: "bg-amber-500",
    lime: "bg-lime-500",
    green: "bg-green-500",
    emerald: "bg-emerald-500",
    zinc: "bg-zinc-600",
  };

  return colorMap[stageEntry.color] || "bg-zinc-600";
}

/**
 * Get tag color classes for Tailwind
 */
export function getTagColorClasses(color: string): string {
  const colorMap: Record<string, string> = {
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    green: "bg-green-500/20 text-green-400 border-green-500/30",
    cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  };

  return colorMap[color] || colorMap.blue;
}

/**
 * Get stat card gradient classes
 */
export function getStatCardGradient(color: string): string {
  const colorMap: Record<string, string> = {
    orange: "from-orange-500/20 to-orange-500/5 border-orange-500/30",
    green: "from-green-500/20 to-green-500/5 border-green-500/30",
    emerald: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
    blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    red: "from-red-500/20 to-red-500/5 border-red-500/30",
    purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
    yellow: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30",
  };

  return colorMap[color] || colorMap.blue;
}

/**
 * Get stage priority (higher = closer to completion)
 */
export function getStagePriority(stageName: string): number {
  const stageEntry = Object.values(PROJECT_STAGES).find((s) => s.name === stageName);
  return stageEntry?.priority ?? 0;
}

/**
 * Check if stage is schedulable
 */
export function isStageSchedulable(stageName: string): boolean {
  return SCHEDULABLE_STAGES.includes(stageName as typeof SCHEDULABLE_STAGES[number]);
}

/**
 * Check if stage is active
 */
export function isStageActive(stageName: string): boolean {
  return (ACTIVE_STAGES as readonly string[]).includes(stageName);
}
