/**
 * Bottleneck digest — renders scoped plain-text Chat digests from a
 * BottleneckSnapshot, with change detection against the last-sent snapshot
 * (SystemConfig). Sending goes through the tech-ops bot's owner DM space.
 */

import { prisma } from "@/lib/db";
import {
  computeBottleneckSnapshot,
  refreshThresholds,
  ZOMBIE_DAYS,
  type BottleneckSnapshot,
  type BottleneckTeam,
  type FlaggedDeal,
} from "@/lib/bottlenecks";

const LAST_DIGEST_KEY = "bottleneck_last_digest";
/** The daily digest is the stalled/zombie leadership lens — link to the queue
 *  view explicitly (the tab's default now shows the team worklists). */
const DASHBOARD_URL = "https://www.pbtechops.com/dashboards/project-pipeline-funnel?tab=bottlenecks&view=queues";
// Digits-only guard: this env var has been stored with a literal "\n" before
// (the echo|vercel-env-add gotcha), which silently corrupts every URL built
// from it — Chat's <url|text> parser breaks exactly at the stray characters.
const HUBSPOT_PORTAL = (process.env.HUBSPOT_PORTAL_ID || "").replace(/\D/g, "") || "21710069";

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

/** Only STALLED deals participate in the digest and its change detection —
 *  zombies (untouched ≥ ZOMBIE_DAYS) are a dashboard cleanup list, not daily noise. */
const stalledOf = (flagged: FlaggedDeal[]) => flagged.filter((f) => f.bucket === "stalled");

export function toFlagSnapshot(s: BottleneckSnapshot): FlagSnapshot {
  return Object.fromEntries(
    s.stages.map((x) => [x.key, stalledOf(x.flagged).map((f) => f.hubspotDealId)])
  );
}

export function detectChanges(prev: FlagSnapshot | null, current: BottleneckSnapshot): DigestChanges {
  const newlyFlagged: FlaggedDeal[] = [];
  const resolvedIds: string[] = [];
  for (const stage of current.stages) {
    const stalled = stalledOf(stage.flagged);
    const before = new Set(prev?.[stage.key] ?? []);
    const now = new Set(stalled.map((f) => f.hubspotDealId));
    for (const f of stalled) if (!before.has(f.hubspotDealId)) newlyFlagged.push(f);
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

/** Google Chat app-message hyperlink: <url|text>. Renders as a clickable link. */
function dealLink(f: FlaggedDeal): string {
  const url = `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL}/record/0-3/${f.hubspotDealId}`;
  return `<${url}|${shortName(f.dealName)}>`;
}

export const TEAM_LABELS: Record<BottleneckTeam, string> = {
  design: "Design",
  pi: "P&I",
  ops: "Ops",
  compliance: "Compliance (PE)",
};

export function buildDigestMessage(
  snapshot: BottleneckSnapshot,
  changes: DigestChanges,
  opts: { includeFlow: boolean; teamLabel?: string }
): string | null {
  const stalledTotal = snapshot.stages.reduce((n, s) => n + stalledOf(s.flagged).length, 0);
  const zombieTotal = snapshot.stages.reduce(
    (n, s) => n + (s.flagged.length - stalledOf(s.flagged).length),
    0
  );
  if (stalledTotal === 0 && !changes.hasChanges && !opts.includeFlow) return null;

  const day = new Date(snapshot.computedAt).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });

  const title = opts.teamLabel ? `${opts.teamLabel} bottleneck digest` : "Bottleneck digest";
  const lines: string[] = [`🚧 ${title} — ${day}`];
  const delta =
    changes.newlyFlagged.length || changes.resolvedIds.length
      ? ` (${changes.newlyFlagged.length} new, ${changes.resolvedIds.length} resolved)`
      : "";
  lines.push(`${stalledTotal} stalled deal${stalledTotal === 1 ? "" : "s"} to work${delta}`);
  lines.push("");

  for (const s of snapshot.stages) {
    const stalled = stalledOf(s.flagged);
    if (stalled.length === 0 && !(opts.includeFlow && s.flow.length > 0)) continue;
    lines.push(`${s.label}: ${stalled.length} stalled / ${s.totalInStage} in stage, threshold ${s.effective.days}d`);
    for (const f of stalled.slice(0, 3)) {
      const status = f.status ? ` — ${f.status}` : "";
      const quiet = f.daysSinceActivity != null ? `, quiet ${f.daysSinceActivity}d` : "";
      const where = f.pbLocation ? ` (${f.pbLocation})` : "";
      lines.push(`• ${dealLink(f)}${status} — ${f.dwellDays}d in stage${quiet}${where}`);
    }
    if (stalled.length > 3) lines.push(`…and ${stalled.length - 3} more.`);
    if (opts.includeFlow && s.flow.length > 0) {
      const recent = s.flow.slice(-2);
      const entered = recent.reduce((n, w) => n + w.entered, 0);
      const exited = recent.reduce((n, w) => n + w.exited, 0);
      lines.push(`↳ flow: ${entered} in / ${exited} out (last 2 weeks)`);
    }
    lines.push("");
  }

  if (zombieTotal > 0) {
    lines.push(`🧟 ${zombieTotal} zombie${zombieTotal === 1 ? "" : "s"} (untouched ${ZOMBIE_DAYS}d+) excluded — cleanup list on the dashboard.`);
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
  team?: BottleneckTeam;
  message?: string; // preview mode only
}

export async function runBottleneckDigest(opts?: {
  nowMs?: number;
  preview?: boolean;
  /**
   * Team-scoped TEST send: filters to the team's stages, labels the header,
   * always sends (no change suppression), and never saves the flag snapshot —
   * so it can't interfere with the daily all-scope cadence. Still delivers to
   * the owner DM only (team delivery targets unlock with bot visibility).
   */
  team?: BottleneckTeam;
}): Promise<BottleneckDigestResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const team = opts?.team;
  const isMonday =
    new Date(nowMs).toLocaleDateString("en-US", { timeZone: "America/Denver", weekday: "short" }) === "Mon";

  // Mondays also refresh derived thresholds (manual overrides preserved).
  if (isMonday && !opts?.preview && !team) await refreshThresholds(nowMs);

  const full = await computeBottleneckSnapshot(nowMs);
  const snapshot = team ? filterSnapshotForScope(full, { kind: "team", team }) : full;
  const prev = team ? null : await getLastFlagSnapshot();
  const changes = detectChanges(prev, snapshot);

  if (!team && !isMonday && !changes.hasChanges) {
    return { posted: false, reason: "no changes since last digest", isMonday };
  }

  const message = buildDigestMessage(snapshot, changes, {
    // Team sends always include flow — they're review/test sends, show everything.
    includeFlow: isMonday || Boolean(team),
    teamLabel: team ? TEAM_LABELS[team] : undefined,
  });
  if (!message) return { posted: false, reason: "nothing to report", isMonday, team };

  if (opts?.preview) return { posted: false, isMonday, team, message };

  const { getOwnerDmSpace } = await import("@/lib/tech-ops-bot-proactive");
  const space = await getOwnerDmSpace();
  if (!space) return { posted: false, reason: "owner DM space not captured yet", isMonday, team };

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  await postGoogleChatMessage({ spaceName: space, text: message });
  if (!team) await saveFlagSnapshot(toFlagSnapshot(snapshot));
  return { posted: true, isMonday, team };
}
