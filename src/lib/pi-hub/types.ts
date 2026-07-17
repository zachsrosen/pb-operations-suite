export type Team = "permit" | "ic" | "pto";
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
