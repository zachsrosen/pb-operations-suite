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
  /** Additional people whose PERSONAL worklists should include this line
   *  (e.g. overdue surveys go to the ops director as well as the surveyor). */
  alsoNotify?: string[];
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
/** PE statuses that mean "ready to go back out the door". */
const PE_READY_RESUBMIT = new Set(["Ready to Resubmit", "Onboarding Ready to Resubmit"]);
/** PE API status vocabulary for "needs a response" (PeDocumentReview/PeDocChangeLog). */
export const PE_REJECTED_STATUSES = ["ACTION_REQUIRED", "REJECTED"];

export interface PeRecentRejection {
  docs: string[];
  daysAgo: number; // since the most recent rejection flip
}

/**
 * Deals with docs CURRENTLY in a rejected state (PeDocumentReview is the live
 * per-doc status table), with recency from the change log's latest rejection
 * flip. Using current state — not just flips — means the PE ANCHOR
 * reconciler's reject-then-reapprove no-ops filter themselves out, and open
 * rejections older than any window still show (freshest sort surfaces the
 * "recent" ones Zach asked for).
 */
export async function getRecentPeRejections(
  nowMs = Date.now()
): Promise<Map<string, PeRecentRejection>> {
  if (!prisma) return new Map();
  const open = await prisma.peDocumentReview.findMany({
    where: { status: { in: ["ACTION_REQUIRED", "REJECTED"] } },
    select: { dealId: true, docName: true, updatedAt: true },
  });
  if (open.length === 0) return new Map();

  // Recency: latest rejection flip per (deal, doc) from the change log; falls
  // back to the review row's updatedAt when no log entry exists.
  const flips = await prisma.peDocChangeLog.findMany({
    where: {
      newStatus: { in: PE_REJECTED_STATUSES },
      dealId: { in: [...new Set(open.map((o) => o.dealId))] },
    },
    select: { dealId: true, docName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const flipAt = new Map<string, number>();
  for (const f of flips) {
    const k = `${f.dealId}::${f.docName}`;
    if (!flipAt.has(k)) flipAt.set(k, f.createdAt.getTime());
  }

  const map = new Map<string, PeRecentRejection>();
  for (const o of open) {
    const ts = flipAt.get(`${o.dealId}::${o.docName}`) ?? o.updatedAt.getTime();
    const daysAgo = Math.floor((nowMs - ts) / 86_400_000);
    const e = map.get(o.dealId) ?? { docs: [], daysAgo: 9999 };
    if (!e.docs.includes(o.docName)) e.docs.push(o.docName);
    e.daysAgo = Math.min(e.daysAgo, daysAgo);
    map.set(o.dealId, e);
  }
  return map;
}

export function buildTeamSections(
  team: TeamDigestKey,
  dd: ProjectFunnelDrillDown,
  peRows: BottleneckDealRow[],
  nowMs: number,
  extras?: { peRecentRejections?: Map<string, PeRecentRejection> }
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
    case "ops": {
      // Overdue = scheduled date is in the PAST and the work still isn't done.
      // Future-scheduled deals are on plan, not bottlenecks (and would render
      // as negative days) — they're excluded entirely.
      const DAY = 86_400_000;
      const overdue = (
        title: string,
        deals: ProjectFunnelDrillDownDeal[],
        lead: (d: ProjectFunnelDrillDownDeal) => string
      ): DigestSection => {
        const lines = deals
          .filter(workable)
          .filter((d) => d.scheduledDate && Date.parse(`${d.scheduledDate}T12:00:00`) < nowMs)
          .map((d) => ({
            ...toLine(d, lead(d), null),
            daysWaiting: Math.floor((nowMs - Date.parse(`${d.scheduledDate}T12:00:00`)) / DAY),
            needsFollowUp: true, // past its scheduled date by definition
          }))
          .sort((a, b) => b.daysWaiting - a.daysWaiting);
        return { title, followUpDays: 0, groupBy: "lead", lines };
      };
      const surveys = overdue("Overdue site surveys (days past scheduled date)", dd.awaitingSurvey, (d) => leadOf(d.siteSurveyor, leadOf(d.projectManager)));
      // Overdue surveys also land in the ops director's PERSONAL worklist,
      // not just the surveyor's (per Zach 7/8).
      const opsMgrByDeal = new Map(dd.awaitingSurvey.map((d) => [String(d.id), leadOf(d.operationsManager, "")]));
      for (const l of surveys.lines) {
        const mgr = opsMgrByDeal.get(l.id);
        if (mgr && mgr !== "—" && mgr !== "" && mgr !== l.lead) l.alsoNotify = [mgr];
      }
      return [
        surveys,
        overdue("Overdue installs (days past scheduled date)", dd.awaitingConstructionComplete, (d) => leadOf(d.operationsManager, leadOf(d.projectManager))),
        section("Inspections to pass", dd.awaitingInspection, (d) => leadOf(d.inspectionsLead, leadOf(d.operationsManager)), 14),
      ];
    }
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
      // Compliance only works deals in PTO / Close Out (M1 is post-inspection,
      // M2 post-PTO) — earlier-stage deals with PE statuses are not actionable
      // for the team yet (per Zach 7/8).
      const COMPLIANCE_STAGES = new Set(["permission to operate", "close out"]);
      const inComplianceStage = (r: BottleneckDealRow) =>
        COMPLIANCE_STAGES.has((r.stage ?? "").trim().toLowerCase());
      const DAY_MS = 86_400_000;
      const peStage = (key: "pe_m1" | "pe_m2") => STAGES.find((s) => s.key === key)!;
      const peStatusOf = (r: BottleneckDealRow, statusProp: string): string | null => {
        const raw = r.rawProperties as Record<string, unknown> | null;
        const v = raw && typeof raw === "object" ? raw[statusProp] : null;
        return typeof v === "string" && v ? v : null;
      };
      const peLines = (
        key: "pe_m1" | "pe_m2",
        statusProp: string,
        want: (status: string) => boolean,
        followUpDays: number | null
      ): DigestSection["lines"] => {
        const stage = peStage(key);
        return peRows
          .filter((r) => {
            if (!r.isParticipateEnergy || !inComplianceStage(r)) return false;
            const status = peStatusOf(r, statusProp);
            return status != null && want(status);
          })
          .map((r) => {
            const status = peStatusOf(r, statusProp) ?? "";
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
      const readyOrResubmit = (s: string) => statusBucket(s) === "ready" || PE_READY_RESUBMIT.has(s);
      const inReview = (s: string) => statusBucket(s) === "review";

      // Recent rejections: deals with a PE doc flipped to Rejected/Internally
      // Rejected/Onboarding Rejected in the trailing window (PeDocChangeLog),
      // with the doc names on the line and days since the latest flip.
      const rejections = extras?.peRecentRejections ?? new Map<string, PeRecentRejection>();
      const rowById = new Map(peRows.map((r) => [r.hubspotDealId, r]));
      const rejectionLines: DigestSection["lines"] = [...rejections.entries()]
        .map(([dealId, rej]) => {
          const r = rowById.get(dealId);
          if (!r || !r.isParticipateEnergy || !inComplianceStage(r)) return null;
          return {
            id: dealId,
            name: r.dealName ?? "(unnamed)",
            status: rej.docs.join(", "),
            stage: r.stage ?? "",
            daysWaiting: rej.daysAgo,
            lead: "",
            location: r.pbLocation ?? "",
            needsFollowUp: true,
            blockedNote: null,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l != null)
        .sort((a, b) => a.daysWaiting - b.daysWaiting); // freshest rejection first

      // Priority order: rejections demand a response, submitted need chasing,
      // ready lists are the (large) backlog — they truncate gracefully when
      // the Chat char budget runs out, the urgent sections never should.
      return [
        { title: "Open rejections — respond to PE (docs, days since rejected)", followUpDays: 0, groupBy: "location", lines: rejectionLines },
        { title: "M1 submitted — follow up with PE", followUpDays: 14, groupBy: "location", lines: peLines("pe_m1", "pe_m1_status", inReview, 14) },
        { title: "M2 submitted — follow up with PE", followUpDays: 14, groupBy: "location", lines: peLines("pe_m2", "pe_m2_status", inReview, 14) },
        { title: "M1 ready to submit / resubmit", followUpDays: null, groupBy: "location", lines: peLines("pe_m1", "pe_m1_status", readyOrResubmit, null) },
        { title: "M2 ready to submit / resubmit", followUpDays: null, groupBy: "location", lines: peLines("pe_m2", "pe_m2_status", readyOrResubmit, null) },
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

/** One deal-load + funnel build, reused for any number of team section builds. */
async function loadWorklistInputs(nowMs: number) {
  if (!prisma) return null;
  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
  });
  const projects = deals.map(dealToProject);
  const funnel = buildProjectFunnelData(projects, 6, undefined, undefined, undefined, {
    scope: "active",
  });
  const peRecentRejections = await getRecentPeRejections(nowMs);
  return { deals: deals as unknown as BottleneckDealRow[], dd: funnel.drillDown, peRecentRejections };
}

/** Load the live pipeline and build one team's worklist sections (DB entry point). */
export async function getTeamSections(
  team: TeamDigestKey,
  nowMs = Date.now()
): Promise<DigestSection[]> {
  const inputs = await loadWorklistInputs(nowMs);
  if (!inputs) return [];
  return buildTeamSections(team, inputs.dd, inputs.deals, nowMs, {
    peRecentRejections: inputs.peRecentRejections,
  });
}

/** Every team's sections from ONE load — the tab's all-teams overview. */
export async function getAllTeamSections(
  nowMs = Date.now()
): Promise<Array<{ team: TeamDigestKey; label: string; sections: DigestSection[] }>> {
  const inputs = await loadWorklistInputs(nowMs);
  if (!inputs) return [];
  // Ops leads the page (field execution first — per Zach, it's what
  // leadership looks for), then the project-team functions.
  const DISPLAY_ORDER: TeamDigestKey[] = ["ops", "design", "permitting", "ic", "pm", "sales", "compliance"];
  return DISPLAY_ORDER.map((team) => ({
    team,
    label: TEAM_DIGEST_LABELS[team],
    sections: buildTeamSections(team, inputs.dd, inputs.deals, nowMs, {
      peRecentRejections: inputs.peRecentRejections,
    }),
  }));
}

export async function runTeamDigest(
  team: TeamDigestKey,
  opts?: { nowMs?: number; preview?: boolean }
): Promise<TeamDigestResult> {
  if (!prisma) return { posted: false, team, reason: "db unavailable" };
  const nowMs = opts?.nowMs ?? Date.now();
  const sections = await getTeamSections(team, nowMs);
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

// ── Personal worklists — one DM per responsible person ──

const PERSONAL_TEAMS: TeamDigestKey[] = ["design", "permitting", "ic", "ops", "sales", "pm"];
// Compliance is excluded: no per-deal compliance lead exists (grouped by office).

export interface PersonalWorklist {
  person: string;
  email: string | null; // resolved from the User table; null = unmatched, never guessed
  sections: Array<{ team: TeamDigestKey; section: DigestSection }>;
  totalDeals: number;
}

/** Pivot the team sections into per-person worklists (pure). */
/** A redirect target: a person, or a per-office split (lowercased location → person). */
export type RedirectTarget = string | { byLocation: Record<string, string> };

export function buildPersonalWorklists(
  sectionsByTeam: Array<{ team: TeamDigestKey; sections: DigestSection[] }>,
  /** Coverage redirects: lowercased from-name → target. String = simple
   *  handoff (Roland → Lenny); byLocation splits a person's lines to regional
   *  owners by the DEAL's office (Derek → Drew/Joe/Lenny/nick). Unmapped
   *  locations stay with the original person. Lines keep their original lead. */
  redirects?: Map<string, RedirectTarget>
): Omit<PersonalWorklist, "email">[] {
  const redirect = (p: string, location: string) => {
    const target = redirects?.get(p.trim().toLowerCase());
    if (!target) return p;
    if (typeof target === "string") return target;
    return target.byLocation[location.trim().toLowerCase()] ?? p;
  };
  const byPerson = new Map<string, Map<string, { team: TeamDigestKey; section: DigestSection }>>();
  for (const { team, sections } of sectionsByTeam) {
    for (const s of sections) {
      if (s.groupBy !== "lead") continue;
      for (const l of s.lines) {
        const primary = l.lead && l.lead !== "—" ? l.lead : null;
        const recipients = [...new Set([primary, ...(l.alsoNotify ?? [])].map((p) => (p ? redirect(p, l.location) : p)))].filter(
          (p): p is string => Boolean(p && p !== "—")
        );
        for (const person of recipients) {
          const key = `${team}::${s.title}`;
          const personMap = byPerson.get(person) ?? new Map();
          const entry =
            personMap.get(key) ??
            { team, section: { title: s.title, followUpDays: s.followUpDays, groupBy: s.groupBy, lines: [] as DigestLine[] } };
          entry.section.lines.push(l);
          personMap.set(key, entry);
          byPerson.set(person, personMap);
        }
      }
    }
  }
  return [...byPerson.entries()]
    .map(([person, m]) => {
      const sections = [...m.values()];
      return {
        person,
        sections,
        totalDeals: sections.reduce((n, e) => n + e.section.lines.length, 0),
      };
    })
    .sort((a, b) => b.totalDeals - a.totalDeals);
}

export function renderPersonalWorklist(w: Omit<PersonalWorklist, "email">, nowMs: number): string {
  const day = new Date(nowMs).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });
  const out: string[] = [
    `👋 ${w.person.split(" ")[0]} — your pipeline worklist for ${day}`,
    `${w.totalDeals} of your deals ${w.totalDeals === 1 ? "needs" : "need"} a next step`,
    "",
  ];
  let used = out.join("\n").length + 200;
  let cut = 0;
  for (const { team, section: s } of w.sections) {
    const header = `${TEAM_DIGEST_LABELS[team]} — ${s.title} (${s.lines.length})`;
    if (used + header.length > CHAT_CHAR_BUDGET) { cut += s.lines.length; continue; }
    out.push(header); used += header.length + 1;
    for (const l of [...s.lines].sort((a, b) => b.daysWaiting - a.daysWaiting)) {
      const status = l.status ? ` — ${l.status}` : "";
      const stage = l.stage ? ` — ${l.stage}` : "";
      const mark = l.needsFollowUp ? " ⚠" : "";
      const blocked = l.blockedNote ? ` [${l.blockedNote}]` : "";
      const where = l.location ? ` (${l.location})` : "";
      const line = `• ${dealLink(l.id, l.name)}${status}${stage} — ${l.daysWaiting}d${mark}${blocked}${where}`;
      if (used + line.length > CHAT_CHAR_BUDGET) { cut++; continue; }
      out.push(line); used += line.length + 1;
    }
    out.push(""); used += 1;
  }
  if (cut > 0) out.push(`…${cut} more didn't fit — full list on the dashboard.`);
  // Deep-link to the personal worklist view — the dashboard renders exactly
  // this list (same pivot), not the generic queue view.
  out.push(`Dashboard: ${FUNNEL_TAB_URL}&view=personal&person=${encodeURIComponent(w.person)}`);
  return out.join("\n");
}

/**
 * One person's cross-team worklist sections, titles prefixed with the team
 * label — the dashboard's `view=personal` mode renders these so the page
 * matches the personal digest exactly.
 */
export async function getPersonalSections(
  person: string,
  nowMs = Date.now()
): Promise<DigestSection[]> {
  if (!prisma) return [];
  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
  });
  const projects = deals.map(dealToProject);
  const funnel = buildProjectFunnelData(projects, 6, undefined, undefined, undefined, { scope: "active" });
  const sectionsByTeam = PERSONAL_TEAMS.map((team) => ({
    team,
    sections: buildTeamSections(team, funnel.drillDown, deals as unknown as BottleneckDealRow[], nowMs),
  }));
  const target = person.trim().toLowerCase();
  const w = buildPersonalWorklists(sectionsByTeam, await getDeliveryRedirects()).find(
    (x) => x.person.trim().toLowerCase() === target
  );
  if (!w) return [];
  return w.sections.map(({ team, section }) => ({
    ...section,
    title: `${TEAM_DIGEST_LABELS[team]} — ${section.title}`,
  }));
}

/** Coverage redirects from SystemConfig `bottleneck_delivery_redirects`
 *  ({"roland valle": "Lenny Uematsu"}). Editable without a deploy. */
export async function getDeliveryRedirects(): Promise<Map<string, RedirectTarget>> {
  if (!prisma) return new Map();
  const row = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_delivery_redirects" } });
  try {
    const obj = row?.value ? JSON.parse(row.value) : {};
    return new Map(
      Object.entries(obj).map(([k, v]) => [
        k.trim().toLowerCase(),
        typeof v === "string" ? v : ({ byLocation: (v as { byLocation: Record<string, string> }).byLocation ?? {} } as RedirectTarget),
      ])
    );
  } catch {
    return new Map();
  }
}

// One-time welcome tracking (SystemConfig set of emails).
const WELCOMED_KEY = "bottleneck_personal_welcomed";
async function getWelcomedSet(): Promise<Set<string>> {
  if (!prisma) return new Set();
  const row = await prisma.systemConfig.findUnique({ where: { key: WELCOMED_KEY } });
  try {
    const arr = row?.value ? JSON.parse(row.value) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
async function markWelcomed(email: string): Promise<void> {
  if (!prisma) return;
  const set = await getWelcomedSet();
  set.add(email);
  const value = JSON.stringify([...set]);
  await prisma.systemConfig.upsert({
    where: { key: WELCOMED_KEY },
    create: { key: WELCOMED_KEY, value },
    update: { value },
  });
}

export interface PersonalSendResult {
  person: string;
  email: string | null;
  deals: number;
  sent: boolean;
  reason?: string;
}

/**
 * Build every person's worklist and deliver it.
 * mode "preview"   → JSON summaries only (nothing sent).
 * mode "dryrun"    → each digest posted to the OWNER's DM, labeled with the
 *                    intended recipient (safe review; default).
 * mode "provision" → no digests sent; force-create each person's DM with the
 *                    bot via domain-wide delegation and record it in the
 *                    delivery map. The bot appears in their Chat silently.
 * mode "live"      → real DMs to recorded spaces. Requires the
 *                    bottleneck_personal_worklists_enabled SystemConfig flag.
 * Emails resolve strictly from the User table by exact (case-insensitive)
 * name match — unmatched people are reported, never guessed.
 */
export async function runPersonalWorklists(opts: {
  mode: "preview" | "dryrun" | "provision" | "live";
  nowMs?: number;
  limit?: number;
  /** Emails to skip entirely (e.g. someone out of office). */
  exclude?: string[];
}): Promise<{ results: PersonalSendResult[]; unmatched: string[] }> {
  if (!prisma) return { results: [], unmatched: [] };
  const nowMs = opts.nowMs ?? Date.now();

  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
  });
  const projects = deals.map(dealToProject);
  const funnel = buildProjectFunnelData(projects, 6, undefined, undefined, undefined, { scope: "active" });
  const sectionsByTeam = PERSONAL_TEAMS.map((team) => ({
    team,
    sections: buildTeamSections(team, funnel.drillDown, deals as unknown as BottleneckDealRow[], nowMs),
  }));
  const worklists = buildPersonalWorklists(sectionsByTeam, await getDeliveryRedirects()).slice(0, opts.limit ?? 100);

  const users = await prisma.user.findMany({ select: { name: true, email: true } });
  const emailByName = new Map(
    users.filter((u) => u.name).map((u) => [u.name!.trim().toLowerCase(), u.email])
  );
  // Second VERIFIED source: HubSpot owners (lead-field names originate there,
  // so spelling matches even when the User table differs — e.g. Roland/Rolando).
  try {
    const { getOwnerNameEmailMap } = await import("@/lib/hubspot-tasks");
    for (const [name, email] of await getOwnerNameEmailMap()) {
      if (!emailByName.has(name)) emailByName.set(name, email);
    }
  } catch {
    // owners lookup is best-effort; User-table matches still work without it
  }

  const results: PersonalSendResult[] = [];
  const unmatched: string[] = [];

  if (opts.mode === "live") {
    const flag = await prisma.systemConfig.findUnique({
      where: { key: "bottleneck_personal_worklists_enabled" },
    });
    if (flag?.value !== "true") {
      return {
        results: worklists.map((w) => ({
          person: w.person, email: null, deals: w.totalDeals, sent: false,
          reason: "bottleneck_personal_worklists_enabled is not 'true'",
        })),
        unmatched,
      };
    }
  }

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  const { getOwnerDmSpace, getUserDmSpaces } = await import("@/lib/tech-ops-bot-proactive");
  // The chat.bot scope can't CREATE DMs (spaces:setup → scope-insufficient),
  // so live delivery uses the DM spaces the webhook recorded when each person
  // first messaged the bot. No recorded space = they haven't said hi yet.
  const dmSpaces = opts.mode === "live" ? await getUserDmSpaces() : {};

  // Standing exclusions (SystemConfig bottleneck_delivery_exclusions: JSON
  // array of emails) — people who must never receive worklists (e.g. owners
  // on the visibility list only for one-off messages). Merged with per-call.
  let standing: string[] = [];
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_delivery_exclusions" } });
    const arr = row?.value ? JSON.parse(row.value) : [];
    if (Array.isArray(arr)) standing = arr;
  } catch { /* best effort */ }
  const excluded = new Set([...standing, ...(opts.exclude ?? [])].map((e) => String(e).trim().toLowerCase()));

  for (const w of worklists) {
    const email = emailByName.get(w.person.trim().toLowerCase()) ?? null;
    if (!email) unmatched.push(w.person);
    const base: PersonalSendResult = { person: w.person, email, deals: w.totalDeals, sent: false };

    if (email && excluded.has(email)) {
      results.push({ ...base, reason: "excluded" });
      continue;
    }

    if (opts.mode === "preview") {
      results.push({ ...base, reason: "preview" });
      continue;
    }
    if (opts.mode === "provision") {
      if (!email) { results.push({ ...base, reason: "no User-table match" }); continue; }
      try {
        const { provisionUserDmSpace } = await import("@/lib/tech-ops-bot-proactive");
        const space = await provisionUserDmSpace(email);
        results.push({ ...base, sent: false, reason: `provisioned ${space}` });
      } catch (e) {
        results.push({ ...base, reason: e instanceof Error ? e.message.slice(0, 200) : "provision failed" });
      }
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const message = renderPersonalWorklist(w, nowMs);
    try {
      if (opts.mode === "dryrun") {
        const owner = await getOwnerDmSpace();
        if (!owner) { results.push({ ...base, reason: "owner DM space missing" }); continue; }
        await postGoogleChatMessage({
          spaceName: owner,
          text: `🧪 TEST — would DM ${w.person}${email ? ` <${email}>` : " (NO USER-TABLE MATCH — would be skipped)"}\n\n${message}`,
        });
        results.push({ ...base, sent: true });
      } else {
        if (!email) { results.push({ ...base, reason: "no User-table match" }); continue; }
        const space = dmSpaces[email];
        if (!space) {
          results.push({ ...base, reason: "no DM space recorded — provision or have them message the bot" });
          continue;
        }
        // First-ever send gets a one-time intro so the worklist isn't contextless.
        const welcomed = await getWelcomedSet();
        const isFirst = !welcomed.has(email);
        const text = isFirst
          ? `👋 Hi! I'm the PB Tech Ops Bot — I'll DM you a worklist like this when deals are waiting on you, and you can reply here with questions about any of them (or anything pipeline-related).\n\n${message}`
          : message;
        await postGoogleChatMessage({ spaceName: space, text });
        if (isFirst) await markWelcomed(email);
        results.push({ ...base, sent: true });
      }
    } catch (e) {
      results.push({ ...base, reason: e instanceof Error ? e.message.slice(0, 200) : "send failed" });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { results, unmatched };
}
