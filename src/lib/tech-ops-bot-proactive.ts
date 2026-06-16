/**
 * Tech Ops Bot — Proactive Daily Digest
 *
 * The bot is otherwise purely reactive. This builds a once-a-day digest and
 * DMs it to the owner (Zach). Three sections:
 *   1. Stuck deals    — active deals sitting past a per-stage day threshold
 *   2. Milestones     — deals that hit a key milestone in the last 24h
 *   3. Escalations    — pending questions, corrections to fold in, bot errors
 *
 * The owner's DM space id is captured the first time they message the bot in a
 * DM (see the webhook route) and stored in SystemConfig — so this no-ops safely
 * until that has happened. Run by /api/cron/tech-ops-bot-digest.
 */

import { prisma } from "@/lib/db";

const OWNER_DM_SPACE_KEY = "techops_bot_owner_dm_space";

/** Email whose DM thread receives the digest. Override via env if needed. */
export function ownerEmail(): string {
  return (process.env.TECH_OPS_BOT_OWNER_EMAIL || "zach@photonbrothers.com")
    .trim()
    .toLowerCase();
}

/** Project pipeline id (matches the count/milestone tools). */
const PROJECT_PIPELINE_ID = "6900017";

/**
 * Per-stage "stuck" thresholds in days, keyed by the DEAL_STAGE_MAP display
 * name (lowercased). Stages move at different speeds, so the limits differ.
 * Stages not listed here (Close Out, Project Complete, On Hold, Cancelled,
 * Rejected) are never flagged.
 */
const STUCK_THRESHOLDS: Record<string, number> = {
  "site survey": 10,
  "design & engineering": 10,
  "permitting & interconnection": 30,
  "rtb - blocked": 14,
  "ready to build": 21,
  "construction": 14,
  "inspection": 14,
  "permission to operate": 21,
};

/** Key milestones worth a heads-up, with their HubSpot date property. */
const ALERT_MILESTONES: Array<{ label: string; prop: string }> = [
  { label: "DA approved", prop: "layout_approval_date" },
  { label: "Permit issued", prop: "permit_completion_date" },
  { label: "Ready to Build", prop: "ready_to_build_date" },
  { label: "Install complete", prop: "construction_complete_date" },
  { label: "Inspection passed", prop: "inspections_completion_date" },
  { label: "PTO granted", prop: "pto_completion_date" },
];

// ── Owner DM space helpers ──

export async function getOwnerDmSpace(): Promise<string | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: OWNER_DM_SPACE_KEY } });
  return row?.value?.trim() || null;
}

export async function setOwnerDmSpace(spaceName: string): Promise<void> {
  if (!prisma || !spaceName) return;
  await prisma.systemConfig.upsert({
    where: { key: OWNER_DM_SPACE_KEY },
    update: { value: spaceName },
    create: { key: OWNER_DM_SPACE_KEY, value: spaceName },
  });
}

// ── Helpers ──

/** HubSpot datetime properties come back as epoch-ms strings or ISO; parse both. */
function parseHubspotDate(v: string | null | undefined): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// ── Section builders ──

/** Section 1: deals sitting past their stage's threshold. */
async function buildStuckSection(now: number): Promise<string | null> {
  const { searchWithRetry, DEAL_STAGE_MAP } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import(
    "@hubspot/api-client/lib/codegen/crm/deals"
  );

  // Bound the result set: only pull deals already past the *smallest* threshold,
  // then apply the precise per-stage limit in code.
  const minThresholdDays = Math.min(...Object.values(STUCK_THRESHOLDS));
  const cutoffMs = now - minThresholdDays * 86_400_000;

  const res = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
          {
            propertyName: "hs_v2_date_entered_current_stage",
            operator: FilterOperatorEnum.Lte,
            value: String(cutoffMs),
          },
        ],
      },
    ],
    properties: ["dealname", "dealstage", "pb_location", "hs_v2_date_entered_current_stage"],
    sorts: ["hs_v2_date_entered_current_stage"],
    limit: 100,
  });

  const stuck: Array<{ name: string; stage: string; days: number; location: string }> = [];
  for (const r of res.results ?? []) {
    const stageName = DEAL_STAGE_MAP[r.properties?.dealstage ?? ""] ?? null;
    if (!stageName) continue;
    const threshold = STUCK_THRESHOLDS[stageName.toLowerCase()];
    if (threshold == null) continue; // not a stage we nudge on
    const enteredMs = parseHubspotDate(r.properties?.hs_v2_date_entered_current_stage);
    if (enteredMs == null) continue;
    const days = Math.floor((now - enteredMs) / 86_400_000);
    if (days >= threshold) {
      stuck.push({
        name: r.properties?.dealname ?? "(unnamed)",
        stage: stageName,
        days,
        location: r.properties?.pb_location ?? "",
      });
    }
  }

  if (stuck.length === 0) return null;
  stuck.sort((a, b) => b.days - a.days);
  const top = stuck.slice(0, 15);
  const lines = top.map(
    (s) => `• ${s.name} — ${s.stage}, ${s.days}d${s.location ? ` (${s.location})` : ""}`
  );
  let out = `🪧 Stuck deals (${stuck.length})\n${lines.join("\n")}`;
  if (stuck.length > top.length) out += `\n…and ${stuck.length - top.length} more.`;
  return out;
}

/** Section 2: deals that hit a key milestone in the last 24h. */
async function buildMilestoneSection(now: number): Promise<string | null> {
  const { searchWithRetry } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import(
    "@hubspot/api-client/lib/codegen/crm/deals"
  );
  const fromMs = now - 24 * 60 * 60 * 1000;

  const groups = await Promise.all(
    ALERT_MILESTONES.map(async (m) => {
      try {
        const res = await searchWithRetry({
          filterGroups: [
            {
              filters: [
                { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
                {
                  propertyName: m.prop,
                  operator: FilterOperatorEnum.Between,
                  value: String(fromMs),
                  highValue: String(now),
                },
              ],
            },
          ],
          properties: ["dealname", "pb_location"],
          limit: 10,
        });
        const names = (res.results ?? []).map((r) => r.properties?.dealname ?? "(unnamed)");
        return { label: m.label, names };
      } catch {
        return { label: m.label, names: [] as string[] };
      }
    })
  );

  const hit = groups.filter((g) => g.names.length > 0);
  if (hit.length === 0) return null;
  const total = hit.reduce((n, g) => n + g.names.length, 0);
  const lines = hit.map((g) => `• ${g.label}: ${g.names.join(", ")}`);
  return `🎉 Milestones in the last 24h (${total})\n${lines.join("\n")}`;
}

/** Section 3: escalation queue + corrections + recent bot errors. */
async function buildEscalationSection(now: number): Promise<string | null> {
  if (!prisma) return null;
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [pending, corrections, errors] = await Promise.all([
    prisma.techOpsBotEscalation.findMany({
      where: {
        status: "PENDING",
        senderEmail: { not: "DEBUG" },
        NOT: { question: { startsWith: "[CORRECTION]" } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { question: true, senderName: true },
    }),
    prisma.techOpsBotEscalation.count({
      where: { status: "PENDING", question: { startsWith: "[CORRECTION]" } },
    }),
    prisma.techOpsBotEscalation.count({
      where: { senderEmail: "DEBUG", createdAt: { gte: dayAgo } },
    }),
  ]);

  if (pending.length === 0 && corrections === 0 && errors === 0) return null;

  const lines: string[] = [];
  if (pending.length > 0) {
    lines.push(`• ${pending.length} question${pending.length === 1 ? "" : "s"} waiting for an answer:`);
    for (const p of pending.slice(0, 5)) {
      lines.push(`   – ${p.question.slice(0, 100)} (${p.senderName})`);
    }
  }
  if (corrections > 0) {
    lines.push(`• ${corrections} correction${corrections === 1 ? "" : "s"} to fold into the playbook`);
  }
  if (errors > 0) {
    lines.push(`• ${errors} bot error${errors === 1 ? "" : "s"} in the last 24h`);
  }
  return `📣 Escalation queue\n${lines.join("\n")}`;
}

// ── Orchestration ──

export interface DigestResult {
  posted: boolean;
  reason?: string;
  sections: number;
}

/**
 * Build the digest message. Returns null if there's nothing worth reporting
 * (so we don't DM an empty "all quiet" every single day).
 */
export async function buildDailyDigestMessage(nowMs?: number): Promise<string | null> {
  const now = nowMs ?? Date.now();
  const [stuck, milestones, escalations] = await Promise.all([
    buildStuckSection(now).catch(() => null),
    buildMilestoneSection(now).catch(() => null),
    buildEscalationSection(now).catch(() => null),
  ]);

  const sections = [stuck, milestones, escalations].filter(
    (s): s is string => Boolean(s)
  );
  if (sections.length === 0) return null;

  const today = new Date(now).toLocaleDateString("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `📋 Daily Tech Ops digest — ${today}\n\n${sections.join("\n\n")}`;
}

/** Build and DM the digest to the owner. Safe to call when nothing is set up. */
export async function runDailyDigest(nowMs?: number): Promise<DigestResult> {
  const space = await getOwnerDmSpace();
  if (!space) {
    return {
      posted: false,
      reason: "owner DM space not captured yet (DM the bot once to register it)",
      sections: 0,
    };
  }

  const message = await buildDailyDigestMessage(nowMs);
  if (!message) {
    return { posted: false, reason: "nothing to report", sections: 0 };
  }

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  await postGoogleChatMessage({ spaceName: space, text: message });
  return { posted: true, sections: message.split("\n\n").length - 1 };
}
