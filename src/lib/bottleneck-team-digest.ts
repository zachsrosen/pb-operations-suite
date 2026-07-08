/**
 * Team-bucket digests — worklists built from the project funnel's own backlog
 * buckets (the numbers the team already trusts on the Active Pipeline tab),
 * sliced by the team that works each bucket, with that team's lead on every
 * line. PE (Compliance) sections come from the bottleneck engine's PE stages,
 * since the funnel doesn't track PE milestones.
 *
 * The daily UNSCOPED digest (stalled/zombie leadership lens) stays in
 * bottleneck-digest.ts — these team digests are the per-team worklists.
 */

import { prisma } from "@/lib/db";
import { dealToProject } from "@/lib/deal-reader";
import {
  buildProjectFunnelData,
  type ProjectFunnelDrillDown,
  type ProjectFunnelDrillDownDeal,
} from "@/lib/project-funnel-aggregation";
import { statusBucket } from "@/lib/pe-milestone-bucket";
import { STAGES, type BottleneckDealRow } from "@/lib/bottlenecks";

const HUBSPOT_PORTAL = (process.env.HUBSPOT_PORTAL_ID || "").replace(/\D/g, "") || "21710069";
const FUNNEL_TAB_URL = "https://www.pbtechops.com/dashboards/project-pipeline-funnel?tab=bottlenecks";

export type TeamDigestKey =
  | "design"
  | "permitting"
  | "ic"
  | "ops"
  | "sales"
  | "pm"
  | "compliance";

export const TEAM_DIGEST_LABELS: Record<TeamDigestKey, string> = {
  design: "Design",
  permitting: "Permitting",
  ic: "Interconnection",
  ops: "Ops",
  sales: "Sales",
  pm: "PM",
  compliance: "Compliance (PE)",
};

/** Permit statuses (display labels + raw values) that mean "back in design". */
const PERMIT_DESIGN_REVISION = new Set([
  "Design Revision In Progress",
  "Revision Ready To Resubmit",
  "In Design For Revision",
  "Returned from Design",
]);

interface DigestLine {
  id: string;
  name: string;
  status: string | null;
  /** Current pipeline stage (e.g. "Permitting & Interconnection"). */
  stage: string;
  daysWaiting: number;
  lead: string;
  location: string;
  needsFollowUp: boolean;
  /** Non-parked blocked context, e.g. "RTB blocked: waiting on HOA". */
  blockedNote: string | null;
}

export interface DigestSection {
  title: string;
  /** Days past which a deal gets the ⚠ follow-up mark (null = no mark). */
  followUpDays: number | null;
  /** Lines are grouped under this axis in the rendered digest. */
  groupBy: "lead" | "location";
  lines: DigestLine[];
}

const leadOf = (v: string | null | undefined, fallback = "—") => (v && v.trim()) || fallback;

function toLine(
  d: ProjectFunnelDrillDownDeal,
  lead: string,
  followUpDays: number | null
): DigestLine {
  return {
    id: String(d.id),
    name: d.name,
    status: d.status,
    stage: d.stage || "",
    daysWaiting: d.daysWaiting,
    lead,
    location: d.pbLocation || "",
    needsFollowUp: followUpDays != null && d.daysWaiting > followUpDays,
    blockedNote:
      d.flag && !d.flag.parked
        ? `${d.flag.label}${d.flag.reason ? `: ${d.flag.reason}` : ""}`
        : null,
  };
}

/** Parked deals (On Hold) are skipped — a deliberate pause is not a worklist item. */
const workable = (d: ProjectFunnelDrillDownDeal) => !(d.flag && d.flag.parked);

function section(
  title: string,
  deals: ProjectFunnelDrillDownDeal[],
  lead: (d: ProjectFunnelDrillDownDeal) => string,
  followUpDays: number | null
): DigestSection {
  const lines = deals
    .filter(workable)
    .map((d) => toLine(d, lead(d), followUpDays))
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
  return { title, followUpDays, groupBy: "lead", lines };
}

/**
 * Build the sections for one team from the funnel drill-down + (for
 * Compliance) the raw Deal rows. Pure — unit-testable without a DB.
 */
export function buildTeamSections(
  team: TeamDigestKey,
  dd: ProjectFunnelDrillDown,
  peRows: BottleneckDealRow[],
  nowMs: number
): DigestSection[] {
  switch (team) {
    case "design": {
      const permitRevisions = dd.awaitingPermitIssue.filter(
        (d) => d.status != null && PERMIT_DESIGN_REVISION.has(d.status)
      );
      return [
        section("DAs to send", dd.awaitingDaSend, (d) => leadOf(d.designLead), null),
        section("Designs to complete", dd.awaitingDesignComplete, (d) => leadOf(d.designLead), null),
        section("Permit revisions in design", permitRevisions, (d) => leadOf(d.designLead), null),
      ];
    }
    case "permitting": {
      const followUps = dd.awaitingPermitIssue.filter(
        (d) => !(d.status != null && PERMIT_DESIGN_REVISION.has(d.status))
      );
      return [
        section("Permits to submit", dd.awaitingPermitSubmit, (d) => leadOf(d.permitLead), null),
        section("Submitted — follow up with AHJ", followUps, (d) => leadOf(d.permitLead), 21),
      ];
    }
    case "ic":
      return [
        section("Interconnection — follow up with utility", dd.awaitingInterconnection, (d) => leadOf(d.interconnectionsLead), 45),
        section("PTO — follow up", dd.awaitingPto, (d) => leadOf(d.interconnectionsLead), 21),
      ];
    case "ops":
      return [
        section("Installs to complete", dd.awaitingConstructionComplete, (d) => leadOf(d.operationsManager, leadOf(d.projectManager)), null),
        section("Inspections to pass", dd.awaitingInspection, (d) => leadOf(d.inspectionsLead, leadOf(d.operationsManager)), 14),
      ];
    case "sales":
      return [
        section("Surveys to schedule", dd.awaitingSurveySchedule, (d) => leadOf(d.dealOwner), null),
      ];
    case "pm":
      return [
        section("Ready to build — clear blockers", dd.awaitingReadyToBuild, (d) => leadOf(d.projectManager), null),
        section("Construction to schedule", dd.awaitingConstructionSchedule, (d) => leadOf(d.projectManager), null),
      ];
    case "compliance": {
      // No per-deal compliance lead exists in HubSpot — grouped by office instead.
      const DAY_MS = 86_400_000;
      const peStage = (key: "pe_m1" | "pe_m2") => STAGES.find((s) => s.key === key)!;
      const peLines = (
        key: "pe_m1" | "pe_m2",
        statusProp: string,
        wantBucket: "ready" | "review",
        followUpDays: number | null
      ): DigestSection["lines"] => {
        const stage = peStage(key);
        return peRows
          .filter((r) => {
            if (!r.isParticipateEnergy) return false;
            const raw = r.rawProperties as Record<string, unknown> | null;
            const status = raw && typeof raw === "object" ? raw[statusProp] : null;
            return typeof status === "string" && statusBucket(status) === wantBucket;
          })
          .map((r) => {
            const raw = r.rawProperties as Record<string, unknown> | null;
            const status = raw && typeof raw === "object" ? String(raw[statusProp] ?? "") : "";
            const entry = stage.entryDate(r);
            const days = entry ? Math.floor((nowMs - entry.getTime()) / DAY_MS) : 0;
            return {
              id: r.hubspotDealId,
              name: r.dealName ?? "(unnamed)",
              status,
              stage: r.stage ?? "",
              daysWaiting: days,
              lead: "",
              location: r.pbLocation ?? "",
              needsFollowUp: followUpDays != null && days > followUpDays,
              blockedNote: null,
            };
          })
          .sort((a, b) => b.daysWaiting - a.daysWaiting);
      };
      return [
        { title: "M1 ready to submit", followUpDays: null, groupBy: "location", lines: peLines("pe_m1", "pe_m1_status", "ready", null) },
        { title: "M1 submitted — follow up with PE", followUpDays: 14, groupBy: "location", lines: peLines("pe_m1", "pe_m1_status", "review", 14) },
        { title: "M2 ready to submit", followUpDays: null, groupBy: "location", lines: peLines("pe_m2", "pe_m2_status", "ready", null) },
        { title: "M2 submitted — follow up with PE", followUpDays: 14, groupBy: "location", lines: peLines("pe_m2", "pe_m2_status", "review", 14) },
      ];
    }
  }
}

// ── Rendering (plain text; Google Chat <url|text> links) ──

function shortName(name: string): string {
  const parts = name.split("|").map((p) => p.trim());
  return parts.slice(0, 2).join(" — ") || name;
}

const dealLink = (id: string, name: string) =>
  `<https://app.hubspot.com/contacts/${HUBSPOT_PORTAL}/record/0-3/${id}|${shortName(name)}>`;

/** Google Chat text messages cap at 4,096 chars — leave headroom for safety. */
const CHAT_CHAR_BUDGET = 3900;

export function renderTeamDigest(
  team: TeamDigestKey,
  sections: DigestSection[],
  nowMs: number
): string | null {
  const total = sections.reduce((n, s) => n + s.lines.length, 0);
  if (total === 0) return null;

  const day = new Date(nowMs).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });

  const footer = `Dashboard: ${FUNNEL_TAB_URL}&view=${team}`;
  const out: string[] = [`🚧 ${TEAM_DIGEST_LABELS[team]} worklist — ${day}`];
  out.push(`${total} deal${total === 1 ? "" : "s"} waiting on your team`);
  out.push("");

  // Show every deal that fits; once the Chat char budget runs out, stop and
  // say how many were cut. Budget counts rendered chars incl. link markup.
  let used = out.join("\n").length + footer.length + 64; // slack for cut-notes
  let cut = 0;

  const push = (line: string): boolean => {
    if (used + line.length + 1 > CHAT_CHAR_BUDGET) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };

  for (const s of sections) {
    if (s.lines.length === 0) continue;
    const flagged = s.followUpDays != null ? s.lines.filter((l) => l.needsFollowUp).length : 0;
    const followNote = s.followUpDays != null ? ` — ${flagged} past ${s.followUpDays}d` : "";
    if (!push(`${s.title} (${s.lines.length}${followNote})`)) { cut += s.lines.length; continue; }

    // Group by the responsible party (lead) or office, biggest group first;
    // within a group, oldest first.
    const groups = new Map<string, typeof s.lines>();
    for (const l of s.lines) {
      const key = (s.groupBy === "location" ? l.location : l.lead) || "(unassigned)";
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );

    for (const [who, lines] of ordered) {
      if (!push(`${who} (${lines.length})`)) { cut += lines.length; continue; }
      for (const l of lines) {
        const status = l.status ? ` — ${l.status}` : "";
        const stage = l.stage ? ` — ${l.stage}` : "";
        const mark = l.needsFollowUp ? " ⚠" : "";
        const blocked = l.blockedNote ? ` [${l.blockedNote}]` : "";
        // Location shown per line only when the grouping isn't already location.
        const where = s.groupBy !== "location" && l.location ? ` (${l.location})` : "";
        if (!push(`• ${dealLink(l.id, l.name)}${status}${stage} — ${l.daysWaiting}d${mark}${blocked}${where}`)) {
          cut++;
        }
      }
    }
    push("");
  }

  if (cut > 0) out.push(`…${cut} more didn't fit — full list on the dashboard.`);
  out.push(footer);
  return out.join("\n");
}

// ── Orchestration ──

export interface TeamDigestResult {
  posted: boolean;
  team: TeamDigestKey;
  reason?: string;
  message?: string; // preview mode only
}

export async function runTeamDigest(
  team: TeamDigestKey,
  opts?: { nowMs?: number; preview?: boolean }
): Promise<TeamDigestResult> {
  if (!prisma) return { posted: false, team, reason: "db unavailable" };
  const nowMs = opts?.nowMs ?? Date.now();

  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
  });
  const projects = deals.map(dealToProject);
  const funnel = buildProjectFunnelData(projects, 6, undefined, undefined, undefined, {
    scope: "active",
  });

  const sections = buildTeamSections(
    team,
    funnel.drillDown,
    deals as unknown as BottleneckDealRow[],
    nowMs
  );
  const message = renderTeamDigest(team, sections, nowMs);
  if (!message) return { posted: false, team, reason: "nothing waiting on this team" };

  if (opts?.preview) return { posted: false, team, message };

  const { getOwnerDmSpace } = await import("@/lib/tech-ops-bot-proactive");
  const space = await getOwnerDmSpace();
  if (!space) return { posted: false, team, reason: "owner DM space not captured yet" };

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  await postGoogleChatMessage({ spaceName: space, text: message });
  return { posted: true, team };
}
