// src/lib/morning-sweep/types.ts
//
// Shared types for the morning sweep — Zach's proactive "get ahead of my
// tasks and tickets" digest. Gathers HubSpot tasks, Freshservice tickets,
// PE action-required docs, and (when connected) email/meeting follow-ups,
// then emails one prioritized brief with pre-drafted ticket replies.

export type TaskBucket = "overdue" | "today" | "upcoming";

/** A single, non-grouped task surfaced individually in the digest. */
export interface SweepTaskItem {
  id: string;
  subject: string;
  priority: "HIGH" | "MEDIUM" | "LOW" | null;
  dueAt: string | null;
  bucket: TaskBucket;
  url: string;
}

/**
 * A family of 3+ same-shape tasks collapsed into one counted row. Covers both
 * bot batches (distinct PROJ each, same subject) and recurring tasks the bot
 * recreates daily — we can't tell them apart without fetching associations, so
 * we surface the count + highest priority and let Zach open to triage.
 */
export interface SweepTaskGroup {
  label: string;
  count: number;
  priority: "HIGH" | "MEDIUM" | "LOW" | null;
  earliestDue: string | null;
  sampleUrl: string;
}

export interface SweepTasks {
  overdue: SweepTaskItem[];
  today: SweepTaskItem[];
  upcoming: SweepTaskItem[];
  groups: SweepTaskGroup[];
  totalOpen: number;
}

export interface SweepTicket {
  id: number;
  subject: string;
  status: string;
  priority: string;
  priorityRank: number;
  ageDays: number;
  descriptionSnippet: string;
  url: string;
}

export interface SweepFreshservice {
  waitingOnMe: SweepTicket[];
  selfRaisedCount: number;
}

export interface SweepPeDeal {
  dealId: string;
  dealName: string;
  issueCount: number;
  docs: string[];
}

export interface SweepPe {
  actionRequiredDealCount: number;
  topDeals: SweepPeDeal[];
}

export interface SweepEmailItem {
  subject: string;
  from: string;
  ageDays: number;
  isMeetingNote: boolean;
}

export interface SweepEmail {
  connected: boolean;
  /** When not connected, why (so the email can tell Zach how to enable it). */
  unavailableReason?: string;
  items: SweepEmailItem[];
}

/** Claude-generated prep layered on top of the raw data. */
export interface SweepDrafts {
  topPriorities: string[];
  /** ticket id -> casual draft reply */
  ticketReplies: Record<string, string>;
}

export interface SweepData {
  /** Denver-local date, YYYY-MM-DD. */
  date: string;
  tasks: SweepTasks;
  freshservice: SweepFreshservice;
  pe: SweepPe;
  email: SweepEmail;
  drafts: SweepDrafts | null;
  errors: string[];
}

export interface MorningSweepResult {
  sent: boolean;
  dryRun: boolean;
  recipient: string;
  taskCount: number;
  ticketCount: number;
  peDealCount: number;
  emailItemCount: number;
  errors: string[];
}
