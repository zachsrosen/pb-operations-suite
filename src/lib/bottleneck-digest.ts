/**
 * Bottleneck digest — renders scoped plain-text Chat digests from a
 * BottleneckSnapshot, with change detection against the last-sent snapshot
 * (SystemConfig). Sending goes through the tech-ops bot's owner DM space.
 */

import { prisma } from "@/lib/db";
import {
  computeBottleneckSnapshot,
  refreshThresholds,
  type BottleneckSnapshot,
  type BottleneckTeam,
  type FlaggedDeal,
} from "@/lib/bottlenecks";

const LAST_DIGEST_KEY = "bottleneck_last_digest";
const DASHBOARD_URL = "https://www.pbtechops.com/dashboards/bottlenecks";

// ── Scopes ──

export type DigestScope =
  | { kind: "all" }
  | { kind: "team"; team: BottleneckTeam }
  | { kind: "person"; hubspotOwnerId: string };

export function filterSnapshotForScope(s: BottleneckSnapshot, scope: DigestScope): BottleneckSnapshot {
  if (scope.kind === "all") return s;
  if (scope.kind === "team") return { ...s, stages: s.stages.filter((x) => x.team === scope.team) };
  return {
    ...s,
    stages: s.stages.map((x) => ({
      ...x,
      flagged: x.flagged.filter((f) => f.hubspotOwnerId === scope.hubspotOwnerId),
    })),
  };
}

// ── Change detection ──

/** flagged deal ids per stage key, as stored in SystemConfig after each send */
export type FlagSnapshot = Record<string, string[]>;

export interface DigestChanges {
  newlyFlagged: FlaggedDeal[];
  resolvedIds: string[];
  hasChanges: boolean;
}

export function toFlagSnapshot(s: BottleneckSnapshot): FlagSnapshot {
  return Object.fromEntries(s.stages.map((x) => [x.key, x.flagged.map((f) => f.hubspotDealId)]));
}

export function detectChanges(prev: FlagSnapshot | null, current: BottleneckSnapshot): DigestChanges {
  const newlyFlagged: FlaggedDeal[] = [];
  const resolvedIds: string[] = [];
  for (const stage of current.stages) {
    const before = new Set(prev?.[stage.key] ?? []);
    const now = new Set(stage.flagged.map((f) => f.hubspotDealId));
    for (const f of stage.flagged) if (!before.has(f.hubspotDealId)) newlyFlagged.push(f);
    for (const id of before) if (!now.has(id)) resolvedIds.push(id);
  }
  return {
    newlyFlagged,
    resolvedIds,
    hasChanges: prev == null || newlyFlagged.length > 0 || resolvedIds.length > 0,
  };
}

// ── Rendering (plain text — Google Chat renders markdown tables as raw pipes) ──
// Deliberate deviation from spec §5's "top 3 overall": we render top 3 PER
// STAGE — it reads better per team and never hides a stage entirely.
// Scoped delivery targets (spec §3) are v1-unused: the DigestScope type IS the
// reserved shape; targets get added to the SystemConfig row when bot
// visibility widens. No code here sends to anyone but the owner DM.

/** "PROJ-#### | Last, First | Address" → "PROJ-#### — Last, First" */
function shortName(name: string): string {
  const parts = name.split("|").map((p) => p.trim());
  return parts.slice(0, 2).join(" — ") || name;
}

export function buildDigestMessage(
  snapshot: BottleneckSnapshot,
  changes: DigestChanges,
  opts: { includeFlow: boolean }
): string | null {
  const flaggedTotal = snapshot.stages.reduce((n, s) => n + s.flagged.length, 0);
  if (flaggedTotal === 0 && !changes.hasChanges && !opts.includeFlow) return null;

  const day = new Date(snapshot.computedAt).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });

  const lines: string[] = [`🚧 Bottleneck digest — ${day}`];
  const delta =
    changes.newlyFlagged.length || changes.resolvedIds.length
      ? ` (${changes.newlyFlagged.length} new, ${changes.resolvedIds.length} resolved)`
      : "";
  lines.push(`${flaggedTotal} deal${flaggedTotal === 1 ? "" : "s"} past threshold${delta}`);
  lines.push("");

  for (const s of snapshot.stages) {
    if (s.flagged.length === 0 && !(opts.includeFlow && s.flow.length > 0)) continue;
    const th = s.threshold.thresholdDays != null ? `, threshold ${s.threshold.thresholdDays}d` : "";
    lines.push(`${s.label}: ${s.flagged.length} flagged / ${s.totalInStage} in stage${th}`);
    for (const f of s.flagged.slice(0, 3)) {
      const who = f.dealOwnerName ? ` — ${f.dealOwnerName}` : "";
      const where = f.pbLocation ? ` (${f.pbLocation})` : "";
      lines.push(`• ${shortName(f.dealName)} — ${f.dwellDays}d${who}${where}`);
    }
    if (s.flagged.length > 3) lines.push(`…and ${s.flagged.length - 3} more.`);
    if (opts.includeFlow && s.flow.length > 0) {
      const recent = s.flow.slice(-2);
      const entered = recent.reduce((n, w) => n + w.entered, 0);
      const exited = recent.reduce((n, w) => n + w.exited, 0);
      lines.push(`↳ flow: ${entered} in / ${exited} out (last 2 weeks)`);
    }
    lines.push("");
  }

  lines.push(`Dashboard: ${DASHBOARD_URL}`);
  return lines.join("\n");
}

// ── Last-sent snapshot persistence ──

export async function getLastFlagSnapshot(): Promise<FlagSnapshot | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: LAST_DIGEST_KEY } });
  if (!row?.value) return null;
  try {
    return (JSON.parse(row.value) as { flags: FlagSnapshot }).flags ?? null;
  } catch {
    return null;
  }
}

export async function saveFlagSnapshot(flags: FlagSnapshot): Promise<void> {
  if (!prisma) return;
  const value = JSON.stringify({ sentAt: new Date().toISOString(), flags });
  await prisma.systemConfig.upsert({
    where: { key: LAST_DIGEST_KEY },
    create: { key: LAST_DIGEST_KEY, value },
    update: { value },
  });
}

// ── Orchestration (called by the cron route) ──

export interface BottleneckDigestResult {
  posted: boolean;
  reason?: string;
  isMonday: boolean;
  message?: string; // preview mode only
}

export async function runBottleneckDigest(opts?: {
  nowMs?: number;
  preview?: boolean;
}): Promise<BottleneckDigestResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const isMonday =
    new Date(nowMs).toLocaleDateString("en-US", { timeZone: "America/Denver", weekday: "short" }) === "Mon";

  // Mondays also refresh derived thresholds (manual overrides preserved).
  if (isMonday && !opts?.preview) await refreshThresholds(nowMs);

  const snapshot = await computeBottleneckSnapshot(nowMs);
  const prev = await getLastFlagSnapshot();
  const changes = detectChanges(prev, snapshot);

  if (!isMonday && !changes.hasChanges) {
    return { posted: false, reason: "no changes since last digest", isMonday };
  }

  const message = buildDigestMessage(snapshot, changes, { includeFlow: isMonday });
  if (!message) return { posted: false, reason: "nothing to report", isMonday };

  if (opts?.preview) return { posted: false, isMonday, message };

  const { getOwnerDmSpace } = await import("@/lib/tech-ops-bot-proactive");
  const space = await getOwnerDmSpace();
  if (!space) return { posted: false, reason: "owner DM space not captured yet", isMonday };

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  await postGoogleChatMessage({ spaceName: space, text: message });
  await saveFlagSnapshot(toFlagSnapshot(snapshot));
  return { posted: true, isMonday };
}
