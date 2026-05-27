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
  // Pipeline snapshot (active jobs at each stage)
  jobsInDesign: number;
  jobsSubmittedForPermit: number;
  totalReadyJobs: number;
  jobsAgingOver2Weeks: number;

  // Weekly throughput (milestone events this week)
  surveysCompletedThisWeek: number;
  dasApprovedThisWeek: number;
  permitsIssuedThisWeek: number;
  icApprovedThisWeek: number;

  // Cycle times (averages across recent completions)
  avgDaysSaleToPermit: number | null;
  avgDesignTurnaroundDays: number | null;
  avgPermitTurnaroundDays: number | null;
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
  noSameDayResponseCount: number;
  avgTimeToRespondHours: number | null;
  proactiveUpdatePct: null; // Coming soon
  openEscalations: null; // Coming soon
  avgEscalationAge: null; // Coming soon
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

export interface ServiceSection {
  // Job pipeline
  activeJobs: number;
  awaitingSiteVisit: number;
  workInProgress: number;
  awaitingInspection: number;

  // Ticket activity
  openTickets: number;
  ticketsCreatedThisWeek: number;
  ticketsClosedThisWeek: number;
  netTicketChange: number;

  // Ticket health
  avgTicketAgeDays: number | null;
  avgResolutionHours: number | null;
  stuckTicketsOver7d: number;
}

export interface DnrRoofingSection {
  // Throughput summary
  dnrActive: number;
  dnrCompletedThisWeek: number;
  roofingActive: number;
  roofingCompletedThisWeek: number;

  // D&R stage breakdown
  dnrPreDetach: number;
  dnrDetachInProgress: number;
  dnrRoofingPhase: number;
  dnrResetBlocked: number;
  dnrResetPhase: number;
  dnrCloseout: number;

  // Roofing stage breakdown
  roofPreProduction: number;
  roofInProduction: number;
  roofPostProduction: number;

  // Aging
  stuckDnrJobs: number;
  stuckRoofingJobs: number;

  // Diagnostic
  unknownDnrStageCount: number;
  unknownRoofingStageCount: number;
}

export interface ShopHealthHeroes {
  weeklyRevenue: HeroMetric;
  sentiment: HeroMetric;
  backlogWeeks: HeroMetric;
  readyToBuild: HeroMetric;
  scheduledInstalls: HeroMetric;
  installsCompleted: HeroMetric;
  ptosReceived: HeroMetric;
  openTickets: HeroMetric;
  dnrRoofingActive: HeroMetric;
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
  service: HealthStatus;
  dnrRoofing: HealthStatus;
}

/** Lightweight deal summary for metric drill-down tables. */
export interface DrilldownDeal {
  id: string;
  name: string;
  projectNumber: string;
  amount: number;
  stage: string;
  pm: string;
  /** Context-specific date (e.g. close date, install date, permit date) */
  date: string | null;
}

export interface DrilldownTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string | null;
  lastModified: string | null;
  ageDays: number | null;
  dealName: string | null;
}

/** Maps metric keys → the underlying deals that compose that count. */
export interface ShopHealthDrilldown {
  // Pipeline
  contractsSigned: DrilldownDeal[];
  backlog: DrilldownDeal[];
  // Preconstruction — snapshot
  inDesign: DrilldownDeal[];
  inPermitting: DrilldownDeal[];
  readyToBuild: DrilldownDeal[];
  agingOver2Weeks: DrilldownDeal[];
  // Preconstruction — throughput
  surveysCompleted: DrilldownDeal[];
  dasApproved: DrilldownDeal[];
  permitsIssued: DrilldownDeal[];
  icApproved: DrilldownDeal[];
  // Scheduling
  scheduledNext2Weeks: DrilldownDeal[];
  scheduledNext4Weeks: DrilldownDeal[];
  // Operations
  installsCompleted: DrilldownDeal[];
  installsPlanned: DrilldownDeal[];
  // Inspections
  awaitingInspection: DrilldownDeal[];
  inspectionsPassed: DrilldownDeal[];
  ptosReceived: DrilldownDeal[];
  // Customer Success
  daysSinceContact: DrilldownDeal[];
  noSameDayResponse: DrilldownDeal[];
  sentimentScores: DrilldownDeal[];
  fiveStarReviews: DrilldownDeal[];
  responseTime: DrilldownDeal[];

  // Service section
  serviceActiveJobs: DrilldownDeal[];
  serviceAwaitingSiteVisit: DrilldownDeal[];
  serviceWorkInProgress: DrilldownDeal[];
  serviceAwaitingInspection: DrilldownDeal[];
  serviceOpenTickets: DrilldownTicket[];
  serviceTicketsCreated: DrilldownTicket[];
  serviceTicketsClosed: DrilldownTicket[];
  serviceStuckTickets: DrilldownTicket[];

  // D&R + Roofing section
  dnrActive: DrilldownDeal[];
  dnrCompleted: DrilldownDeal[];
  dnrPreDetach: DrilldownDeal[];
  dnrDetachInProgress: DrilldownDeal[];
  dnrRoofingPhase: DrilldownDeal[];
  dnrResetBlocked: DrilldownDeal[];
  dnrResetPhase: DrilldownDeal[];
  dnrCloseout: DrilldownDeal[];
  dnrStuck: DrilldownDeal[];
  roofingActive: DrilldownDeal[];
  roofingCompleted: DrilldownDeal[];
  roofingPreProduction: DrilldownDeal[];
  roofingInProduction: DrilldownDeal[];
  roofingPostProduction: DrilldownDeal[];
  roofingStuck: DrilldownDeal[];
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
  service: ServiceSection;
  dnrRoofing: DnrRoofingSection;
  sectionHealth: SectionHealth;
  bottlenecks: ShopHealthBottleneckEntry[];
  drilldown: ShopHealthDrilldown;
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
  openTickets: HeroMetric;
  dnrActive: HeroMetric;
  roofingActive: HeroMetric;
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
