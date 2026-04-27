/**
 * Shared types for the Shit Show Meeting client + components.
 * Mirrors the Prisma row shapes, narrowed to what the UI needs.
 */

export type ShitShowDecision =
  | "PENDING"
  | "RESOLVED"
  | "STILL_PROBLEM"
  | "ESCALATED"
  | "DEFERRED";

export type ShitShowSyncStatus = "PENDING" | "SYNCED" | "FAILED";

export type ShitShowAssignmentStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export interface ShitShowAssignment {
  id: string;
  sessionItemId: string;
  assigneeUserId: string;
  dueDate: string | null;
  actionText: string;
  status: ShitShowAssignmentStatus;
  hubspotTaskId: string | null;
  taskSyncStatus: ShitShowSyncStatus;
  taskSyncError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShitShowItem {
  id: string;
  sessionId: string;
  dealId: string;
  region: string;
  sortOrder: number;
  dealName: string;
  dealAmount: number | null;
  systemSizeKw: number | null;
  stage: string | null;
  dealOwner: string | null;
  reasonSnapshot: string | null;
  flaggedSince: string | null;
  address: string | null;
  projectType: string | null;
  equipmentSummary: string | null;
  surveyStatus: string | null;
  surveyDate: string | null;
  designStatus: string | null;
  designApprovalStatus: string | null;
  plansetDate: string | null;
  ahj: string | null;
  utilityCompany: string | null;
  projectManager: string | null;
  operationsManager: string | null;
  siteSurveyor: string | null;
  driveFolderUrl: string | null;
  surveyFolderUrl: string | null;
  designFolderUrl: string | null;
  salesFolderUrl: string | null;
  openSolarUrl: string | null;
  meetingNotes: string | null;
  decision: ShitShowDecision;
  decisionRationale: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  hubspotNoteId: string | null;
  noteSyncStatus: ShitShowSyncStatus;
  noteSyncError: string | null;
  idrEscalationQueueId: string | null;
  hubspotEscalationTaskId: string | null;
  addedBy: "SYSTEM" | "MANUAL";
  addedByUser: string | null;
  createdAt: string;
  updatedAt: string;
  assignments: ShitShowAssignment[];
}

export interface ShitShowSession {
  id: string;
  date: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: ShitShowItem[];
}

export interface PresenceUser {
  email: string;
  name: string | null;
  sessionId: string | null;
  selectedItemId: string | null;
  lastSeen: number;
}

export const DECISION_PILL: Record<
  ShitShowDecision,
  { bg: string; text: string; label: string }
> = {
  PENDING: { bg: "bg-zinc-700", text: "text-zinc-100", label: "Pending" },
  RESOLVED: { bg: "bg-emerald-700", text: "text-emerald-50", label: "Resolved" },
  STILL_PROBLEM: { bg: "bg-amber-700", text: "text-amber-50", label: "Still problem" },
  ESCALATED: { bg: "bg-red-700", text: "text-red-50", label: "Escalated" },
  DEFERRED: { bg: "bg-zinc-600", text: "text-zinc-100", label: "Deferred" },
};
