// Type-only imports — erased at compile time, so this file stays free of
// runtime imports and is safe to pull into client bundles. The one runtime
// export (parseTeam) is a pure string narrowing with no server dependencies.
import type { AHJRecord, UtilityRecord } from "@/lib/hubspot-custom-objects";
import type { SharedInboxThread } from "@/lib/gmail-shared-inbox";
import type { SignalType } from "@/lib/approval-scan/classify";

export type Team = "permit" | "ic" | "pto";

/**
 * Narrow an untrusted query param to a Team, or null when invalid. Lives here
 * rather than in access.ts because client components need it and access.ts is
 * server-only (it reads process.env.PI_HUB_ENABLED).
 */
export function parseTeam(value: string | null): Team | null {
  return value === "permit" || value === "ic" || value === "pto" ? value : null;
}

export type GroupKey = "ready" | "rejections" | "resubmit" | "waiting" | "other";
export const GROUP_ORDER: readonly GroupKey[] = ["ready", "rejections", "resubmit", "waiting", "other"];

/** Open approval-signal summary attached to a queue row (flag-gated: the
 *  field is only joined when NEXT_PUBLIC_APPROVAL_SIGNALS_ENABLED is on). */
export interface QueueSignal {
  signalType: SignalType;
  confidence: "high" | "medium";
}

/** Evidence subset the UI renders — mirrors the ApprovalSignal.evidence Json. */
export interface SignalEvidenceView {
  quote: string;
  subject: string;
  mailbox: string;
  threadId: string;
  messageId: string;
  receivedAt: string;
}

/** Open approval signal on the project detail payload. `proposedStatus` is the
 *  HubSpot VALUE the one-click write sends; display `proposedStatusLabel`. */
export interface DetailSignal {
  signalType: SignalType;
  proposedStatus: string;
  proposedStatusLabel: string;
  confidence: "high" | "medium";
  evidence: SignalEvidenceView;
}

export interface QueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  /** HubSpot internal VALUE — routing/filtering only. */
  status: string;
  /** Human label — display this. */
  statusLabel: string;
  dealStage: string | null;
  group: GroupKey;             // computed server-side from config
  daysInStatus: number | null;
  isStale: boolean;
  lead: string | null;
  leadOwnerId: string | null;
  pm: string | null;
  amount: number | null;
  /** Open approval signal, joined in the queue ROUTE (not the cached build) so
   *  a dismiss/resolve never shows a stale badge for the cache's stale window.
   *  Absent when the signals flag is off. */
  signal?: QueueSignal | null;
}

export interface SetStatusResult {
  ok: boolean;
  /** Non-fatal post-write failures ("note failed" etc.). */
  warnings: string[];
}

export interface ProjectDetail {
  deal: {
    id: string;
    name: string;
    address: string | null;
    amount: number | null;
    pbLocation: string | null;
    lead: string | null;
    pm: string | null;
    /** HubSpot internal VALUE — used for routing, not for display. */
    status: string;
    /** Human label for `status`. Display this. */
    statusLabel: string;
    systemSizeKw: number | null;
    dealStage: string | null;
    /** Raw utility application / case number(s) (utility_application__).
     *  Only fetched for IC/PTO; null on the permit team. */
    applicationNumber: string | null;
    /** Xcel IA number(s), comma list on dual-application projects.
     *  Only populated for Xcel deals. */
    xcelIaNumber: string | null;
    hubspotUrl: string;
    designFolderUrl: string | null;
    driveFolderUrl: string | null;
    /** The team's own document folder (config.folderProperty). */
    folderUrl: string | null;
    folderLabel: string;
    /** First domain record's portal link (AHJ or utility, per team). */
    portalUrl: string | null;
    /** First domain record's application link. */
    applicationUrl: string | null;
  };
  domain:
    | { kind: "ahj"; records: AHJRecord[] }
    | { kind: "utility"; records: UtilityRecord[] };
  correspondenceSearchUrl: string | null;
  /** Recent threads from the region's shared inbox — empty when not
   *  configured, service account misconfigured, or no matching threads. */
  correspondenceThreads: SharedInboxThread[];
  /** Which shared inbox the threads came from — shown so the team knows
   *  which mailbox was searched. Null when no thread fetch was attempted. */
  correspondenceInbox: string | null;
  /** This project's application/permit identifier tokens (IA numbers, case
   *  numbers, permit numbers). Used client-side to collapse messages inside
   *  a matched Gmail thread that cite a DIFFERENT project's identifier —
   *  Xcel chatter notifications share one subject line, so Gmail threads
   *  many projects' notifications together. */
  correspondenceIdentifiers: string[];
  /** Open approval signal for this deal+team — drives the detail callout.
   *  Absent/null when the signals flag is off or nothing is flagged. */
  signal?: DetailSignal | null;
  statusHistory: Array<{
    property: string;
    value: string | null;
    timestamp: string;
  }>;
  activity: Array<{
    id: string;
    type: "email" | "call" | "note" | "meeting" | "task";
    subject: string | null;
    body: string | null;
    timestamp: string;
  }>;
}
