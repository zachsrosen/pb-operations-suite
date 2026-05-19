// src/lib/shop-health-types.ts
// Type definitions for the Weekly Shop Health Dashboard

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface HeroMetric {
  value: number;
  priorWeek: number | null;
  delta: number | null;
  health: HealthStatus;
  target: number | null;
}

export interface PipelineSection {
  contractsSigned: number;
  contractsSignedValue: number;
  totalBacklogCount: number;
  totalBacklogValue: number;
  backlogInWeeks: number;
  cancellationCount: number;
  cancellationRate: number;
}

export interface PreconstructionSection {
  jobsInDesign: number;
  jobsSubmittedForPermit: number;
  permitsApprovedThisWeek: number;
  avgDaysSaleToPermit: number | null;
  totalReadyJobs: number;
  jobsAgingOver2Weeks: number;
}

export interface SentimentBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  pct: number;
  color: string;
}

export interface CustomerSuccessSection {
  avgSentimentScore: number | null;
  fiveStarReviewsMTD: number;
  fiveStarReviewsTarget: number;
  npsCsat: null; // Coming soon
  avgDaysSinceContact: number | null;
  proactiveUpdatePct: null; // Coming soon
  openEscalations: null; // Coming soon
  avgEscalationAge: null; // Coming soon
  avgResponseTime: null; // Coming soon
  avgResolutionTime: null; // Coming soon
  changeOrdersPerJob: null; // Coming soon
  activeServiceTickets: null; // Coming soon
  sentimentDistribution: SentimentBucket[];
}

export interface SchedulingSection {
  scheduledNext2Weeks: number;
  scheduledNext4Weeks: number;
  scheduleAccuracy: number | null;
  crewCapacityFilledPct: number;
}

export interface OperationsSection {
  installsCompleted: number;
  installsPlanned: number;
  installsActual: number;
  crewUtilizationPct: number;
}

export interface InspectionsSection {
  jobsAwaitingInspection: number;
  inspectionsPassed: number;
  avgDaysInstallToInspection: number | null;
  ptosReceived: number;
}

export interface ShopHealthHeroes {
  weeklyRevenue: HeroMetric;
  sentiment: HeroMetric;
  backlogWeeks: HeroMetric;
  readyToBuild: HeroMetric;
  scheduledInstalls: HeroMetric;
  installsCompleted: HeroMetric;
  ptosReceived: HeroMetric;
}

export interface ShopHealthGoals {
  monthlyInstalls: number;
  weeklyInstalls: number;
  monthlyInspections: number;
  weeklyInspections: number;
  /** Monthly revenue target from REVENUE_GROUPS annual target (÷12) */
  monthlyRevenueTarget: number;
  /** Weekly revenue target (monthly ÷ 4.3) */
  weeklyRevenueTarget: number;
  /** Average deal size used to derive install targets from revenue */
  avgDealSize: number;
}

export interface SectionHealth {
  pipeline: HealthStatus;
  preconstruction: HealthStatus;
  scheduling: HealthStatus;
  operations: HealthStatus;
  inspections: HealthStatus;
  customerSuccess: HealthStatus;
}

export interface ShopHealthData {
  location: string;
  weekStart: string;
  weekEnd: string;
  heroes: ShopHealthHeroes;
  pipeline: PipelineSection;
  preconstruction: PreconstructionSection;
  scheduling: SchedulingSection;
  operations: OperationsSection;
  inspections: InspectionsSection;
  customerSuccess: CustomerSuccessSection;
  sectionHealth: SectionHealth;
  bottleneck: ShopHealthBottleneckEntry | null;
  lastUpdated: string;
  goals: ShopHealthGoals;
}

export interface ShopHealthBottleneckEntry {
  id: string;
  location: string;
  weekStart: string;
  constraint: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  owner: string | null;
  userId: string;
  updatedAt: string;
}

export interface ShopHealthOverviewRow {
  location: string;
  backlogWeeks: HeroMetric;
  readyToBuild: HeroMetric;
  scheduledInstalls: HeroMetric;
  installsCompleted: HeroMetric;
  ptosReceived: HeroMetric;
  topBottleneck: string | null;
}

export interface ShopHealthOverviewData {
  rows: ShopHealthOverviewRow[];
  weekStart: string;
  weekEnd: string;
  lastUpdated: string;
}

// Diagnostic framework constants from Tracey's presentation
export const BOTTLENECK_DIAGNOSTICS = [
  { signal: 'No leads', owner: 'Marketing' },
  { signal: 'No backlog', owner: 'Sales' },
  { signal: 'No approvals', owner: 'Preconstruction' },
  { signal: 'No schedule', owner: 'PM' },
  { signal: 'Low installs', owner: 'Ops' },
  { signal: 'No closeout', owner: 'Inspections' },
] as const;
