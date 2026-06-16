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

/**
 * Milestones worth a heads-up, with their HubSpot date property. `key` lets a
 * route select a subset (e.g. the P&I room only wants permit/IC milestones).
 */
const ALERT_MILESTONES: Array<{ key: string; label: string; prop: string }> = [
  { key: "da_approved", label: "DA approved", prop: "layout_approval_date" },
  { key: "permit_submitted", label: "Permit submitted", prop: "permit_submit_date" },
  { key: "permit_issued", label: "Permit issued", prop: "permit_completion_date" },
  { key: "ic_submitted", label: "Interconnection submitted", prop: "interconnections_submit_date" },
  { key: "ic_approved", label: "Interconnection approved", prop: "interconnections_completion_date" },
  { key: "rtb", label: "Ready to Build", prop: "ready_to_build_date" },
  { key: "construction_completed", label: "Install complete", prop: "construction_complete_date" },
  { key: "inspection_passed", label: "Inspection passed", prop: "inspections_completion_date" },
  { key: "pto_granted", label: "PTO granted", prop: "pto_completion_date" },
];

/** Default milestone set for broad digests (the headline wins). */
const DEFAULT_MILESTONE_KEYS = [
  "da_approved",
  "permit_issued",
  "rtb",
  "construction_completed",
  "inspection_passed",
  "pto_granted",
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

/** Resolve a raw pb_location against a set of canonical locations. */
async function locationMatcher(
  locations: string[] | null | undefined
): Promise<((raw: string) => boolean) | null> {
  if (!locations || locations.length === 0) return null;
  const { normalizeLocation } = await import("@/lib/locations");
  const wanted = new Set(locations);
  return (raw: string) => {
    const canon = normalizeLocation(raw ?? "");
    return Boolean(canon && wanted.has(canon));
  };
}

/** Section 1: deals sitting past their stage's threshold. */
async function buildStuckSection(
  now: number,
  locations?: string[] | null,
  stages?: string[] | null
): Promise<string | null> {
  const { searchWithRetry, DEAL_STAGE_MAP } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import(
    "@hubspot/api-client/lib/codegen/crm/deals"
  );
  const matches = await locationMatcher(locations);
  // Optional stage focus (e.g. P&I room → only "Permitting & Interconnection").
  const stageFilter =
    stages && stages.length > 0
      ? new Set(stages.map((s) => s.toLowerCase()))
      : null;

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
    if (stageFilter && !stageFilter.has(stageName.toLowerCase())) continue;
    const threshold = STUCK_THRESHOLDS[stageName.toLowerCase()];
    if (threshold == null) continue; // not a stage we nudge on
    const enteredMs = parseHubspotDate(r.properties?.hs_v2_date_entered_current_stage);
    if (enteredMs == null) continue;
    const days = Math.floor((now - enteredMs) / 86_400_000);
    if (days < threshold) continue;
    const location = r.properties?.pb_location ?? "";
    if (matches && !matches(location)) continue;
    stuck.push({
      name: r.properties?.dealname ?? "(unnamed)",
      stage: stageName,
      days,
      location,
    });
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
async function buildMilestoneSection(
  now: number,
  locations?: string[] | null,
  milestoneKeys?: string[] | null
): Promise<string | null> {
  const { searchWithRetry } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import(
    "@hubspot/api-client/lib/codegen/crm/deals"
  );
  const matches = await locationMatcher(locations);
  const fromMs = now - 24 * 60 * 60 * 1000;

  const wantedKeys = new Set(
    milestoneKeys && milestoneKeys.length > 0 ? milestoneKeys : DEFAULT_MILESTONE_KEYS
  );
  const selected = ALERT_MILESTONES.filter((m) => wantedKeys.has(m.key));

  const groups = await Promise.all(
    selected.map(async (m) => {
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
        const names = (res.results ?? [])
          .filter((r) => !matches || matches(r.properties?.pb_location ?? ""))
          .map((r) => r.properties?.dealname ?? "(unnamed)");
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

/** Section: the next 7 days of scheduled work, grouped by date. */
async function buildScheduleSection(
  now: number,
  locations?: string[] | null
): Promise<string | null> {
  const { getUpcomingScheduledJobs } = await import("@/lib/tech-ops-schedule");
  const { jobs } = await getUpcomingScheduledJobs({ days: 7, locations });
  if (jobs.length === 0) return null;

  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "America/Denver",
      weekday: "short",
      month: "numeric",
      day: "numeric",
    });

  const byDate = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const arr = byDate.get(j.date) ?? [];
    arr.push(j);
    byDate.set(j.date, arr);
  }

  const lines: string[] = [];
  for (const [date, dayJobs] of [...byDate.entries()].sort()) {
    lines.push(`${fmt(date)}:`);
    for (const j of dayJobs) {
      lines.push(`   • ${j.type} — ${j.project}${j.crew ? ` (${j.crew})` : ""}`);
    }
  }
  return `🗓️ Scheduled this week (${jobs.length})\n${lines.join("\n")}`;
}

// ── Section composition ──

export type SectionKey = "stuck" | "milestones" | "schedule" | "escalations";

interface SectionOptions {
  locations: string[] | null;
  /** Limit stuck deals to these stage names (default: all nudged stages). */
  stuckStages?: string[] | null;
  /** Limit milestones to these ALERT_MILESTONES keys (default: headline wins). */
  milestoneKeys?: string[] | null;
}

/** Build the requested sections with the given scope/focus; non-empty only. */
async function buildSections(
  now: number,
  sections: SectionKey[],
  opts: SectionOptions
): Promise<string[]> {
  const built = await Promise.all(
    sections.map((key) => {
      switch (key) {
        case "stuck":
          return buildStuckSection(now, opts.locations, opts.stuckStages).catch(() => null);
        case "milestones":
          return buildMilestoneSection(now, opts.locations, opts.milestoneKeys).catch(() => null);
        case "schedule":
          return buildScheduleSection(now, opts.locations).catch(() => null);
        case "escalations":
          // Escalations are the owner's queue — never location-scoped.
          return buildEscalationSection(now).catch(() => null);
        default:
          return Promise.resolve(null);
      }
    })
  );
  return built.filter((s): s is string => Boolean(s));
}

/** Compose the header line(s): "📋 <title> — <date>" plus an optional intro. */
function digestHeader(now: number, title: string, intro?: string): string {
  const today = new Date(now).toLocaleDateString("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const head = `📋 ${title} — ${today}`;
  return intro ? `${head}\n${intro}` : head;
}

// ── Room routes ──

export interface DigestRoute {
  /** Google Chat room display name the bot must be a member of. */
  room: string;
  /** Header title (defaults to a location label). */
  title?: string;
  /** Optional one-line intro under the header. */
  intro?: string;
  /** Canonical locations to scope to; empty = all locations. */
  locations: string[];
  /** Which sections this room receives. */
  sections: SectionKey[];
  /** Limit the stuck-deals section to these stage names. */
  stuckStages?: string[];
  /** Limit the milestones section to these ALERT_MILESTONES keys. */
  milestones?: string[];
  enabled: boolean;
}

/**
 * Team-room digest routes. Each posts a scoped, tailored digest into a Google
 * Chat room (resolved by display name at runtime). Edit here to retune copy,
 * scope, sections, or content focus. Escalations are intentionally omitted —
 * that's the owner's DM queue.
 */
export const DIGEST_ROUTES: DigestRoute[] = [
  {
    room: "Tech Ops",
    title: "Tech Ops — daily pulse",
    intro: "Operational snapshot across all shops.",
    locations: [],
    sections: ["stuck", "milestones", "schedule"],
    enabled: true,
  },
  {
    // TODO(zach): tailor once we know Fight Club's focus — broad default for now.
    room: "Fight Club",
    locations: [],
    sections: ["stuck", "milestones", "schedule"],
    enabled: true,
  },
  {
    room: "Colorado Project Team",
    title: "CO P&I — daily",
    intro: "Where permitting & interconnection stand today.",
    locations: ["Westminster", "Centennial", "Colorado Springs"],
    sections: ["stuck", "milestones"],
    stuckStages: ["Permitting & Interconnection"],
    milestones: ["permit_submitted", "permit_issued", "ic_submitted", "ic_approved"],
    enabled: true,
  },
];

// ── Orchestration ──

export interface DigestResult {
  posted: boolean;
  reason?: string;
  sections: number;
}

/**
 * Build the owner's digest message (all locations; stuck + milestones +
 * escalations). Returns null when there's nothing worth reporting.
 */
export async function buildDailyDigestMessage(nowMs?: number): Promise<string | null> {
  const now = nowMs ?? Date.now();
  const sections = await buildSections(now, ["stuck", "milestones", "escalations"], {
    locations: null,
  });
  if (sections.length === 0) return null;
  return `${digestHeader(now, "Daily Tech Ops digest")}\n\n${sections.join("\n\n")}`;
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

export interface RoomDigestResult {
  room: string;
  posted: boolean;
  reason?: string;
}

/**
 * Build and post each enabled room route's scoped digest. Resolves room
 * display names to space ids via the bot's space list. Rooms the bot isn't a
 * member of, or routes with nothing to report, are skipped (with a reason).
 */
export async function runRoomDigests(nowMs?: number): Promise<RoomDigestResult[]> {
  const routes = DIGEST_ROUTES.filter((r) => r.enabled);
  if (routes.length === 0) return [];

  const now = nowMs ?? Date.now();
  const { listGoogleChatSpaces, postGoogleChatMessage } = await import(
    "@/lib/google-chat-api"
  );

  let spaces: Awaited<ReturnType<typeof listGoogleChatSpaces>> = [];
  try {
    spaces = await listGoogleChatSpaces();
  } catch (e) {
    const reason = e instanceof Error ? e.message : "spaces.list failed";
    return routes.map((r) => ({ room: r.room, posted: false, reason }));
  }

  // Resolve a configured room name to a space the bot belongs to. Matches the
  // exact display name first, then tolerates a parenthetical suffix so
  // "Colorado Project Team" matches "Colorado Project Team (Permitting & …)".
  const norm = (s: string) => s.trim().toLowerCase();
  const resolveSpace = (room: string): string | undefined => {
    const target = norm(room);
    const exact = spaces.find((s) => norm(s.displayName) === target);
    if (exact) return exact.name;
    const prefixed = spaces.find((s) => norm(s.displayName).startsWith(`${target} (`));
    return prefixed?.name;
  };

  const results: RoomDigestResult[] = [];
  for (const route of routes) {
    const spaceName = resolveSpace(route.room);
    if (!spaceName) {
      results.push({
        room: route.room,
        posted: false,
        reason: "bot is not a member of this room",
      });
      continue;
    }

    const sections = await buildSections(now, route.sections, {
      locations: route.locations.length > 0 ? route.locations : null,
      stuckStages: route.stuckStages,
      milestoneKeys: route.milestones,
    });
    if (sections.length === 0) {
      results.push({ room: route.room, posted: false, reason: "nothing to report" });
      continue;
    }

    const title =
      route.title ??
      (route.locations.length > 0
        ? `Daily digest (${route.locations.join(", ")})`
        : "Daily Tech Ops digest");
    const message = `${digestHeader(now, title, route.intro)}\n\n${sections.join("\n\n")}`;
    try {
      await postGoogleChatMessage({ spaceName, text: message });
      results.push({ room: route.room, posted: true });
    } catch (e) {
      results.push({
        room: route.room,
        posted: false,
        reason: e instanceof Error ? e.message : "post failed",
      });
    }
  }

  return results;
}
