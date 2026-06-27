export type WorkType = "install" | "survey" | "inspection" | "service" | "roofing" | "dnr";
export type SubSystem = "PV" | "ESS" | "EV";
export type WorkItemStatus =
  | "unscheduled" | "tentative" | "scheduled" | "en_route"
  | "working" | "done" | "failed" | "cancelled";

export interface WorkItem {
  id: string;
  dealId?: string;
  parentDealId?: string;
  projectNumber?: string;
  customer: string;
  address?: string;
  location: string;
  geo?: { lat: number; lng: number };
  workType: WorkType;
  subSystem?: SubSystem;
  durationDays: number;
  status: WorkItemStatus;
  scheduledStart?: string;
  scheduledEnd?: string;
  assignedResourceIds: string[];
  isTentative: boolean;
  isOverdue: boolean;
  isForecast: boolean;
  hasZuperJob: boolean;
  value?: number;
  zuperJobUid?: string;
  source: "hubspot" | "zuper" | "schedule_record";
}

export interface Resource {
  id: string;
  name: string;
  kind: "crew" | "surveyor" | "inspector" | "tech";
  role?: string;
  locations: string[];
  primaryLocation: string;
  color: string;
  capacityPerDay: number;
  zuperUserUid?: string;
  zuperTeamUid?: string;
  assignable: boolean;
  crewMemberId?: string;
}

export interface Assignment {
  id: string;
  source: "schedule_record" | "booked_slot" | "zuper_job_cache";
  resourceName: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  workType: string;
  location?: string | null;
  workItemId: string;
  projectId: string;
  projectName: string;
  value?: number | null;
  status: string;
}

export interface CapacityCell { resourceId?: string; location: string; date: string; loadDays: number; capacityDays: number; }
export interface AvailabilityWindow { resourceId: string; date: string; startTime: string; endTime: string; available: boolean; reason?: string; }

export type ConflictKind = "double_book" | "over_capacity" | "travel" | "availability" | "weekend_holiday" | "lead_time";
export interface ConflictFlag { kind: ConflictKind; severity: "hard" | "soft"; message: string; detail?: unknown; }
export interface ConflictResult { ok: boolean; hard: ConflictFlag[]; soft: ConflictFlag[]; }

export interface BoardData {
  resources: Resource[];
  workItems: WorkItem[];
  assignments: Assignment[];
  capacity: CapacityCell[];
  dateRange: { start: string; end: string };
}
