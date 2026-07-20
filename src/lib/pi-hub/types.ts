// Type-only imports — erased at compile time, so this file stays free of
// runtime imports and is safe to pull into client bundles. The one runtime
// export (parseTeam) is a pure string narrowing with no server dependencies.
import type { AHJRecord, UtilityRecord } from "@/lib/hubspot-custom-objects";
import type { SharedInboxThread } from "@/lib/gmail-shared-inbox";

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
