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
  resolveMilestones,
  type ProjectFunnelDrillDown,
  type ProjectFunnelDrillDownDeal,
} from "@/lib/project-funnel-aggregation";
import type { Project } from "@/lib/hubspot";
import { statusBucket } from "@/lib/pe-milestone-bucket";
import { STAGES, type BottleneckDealRow } from "@/lib/bottlenecks";
import { statusLabel } from "@/lib/deal-status-labels";
import { PE_DOC_TO_TEAM_FIELD } from "@/lib/pe-rejection-notes";

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

/**
 * design_status raw values (any pipeline stage) where the design team owes a
 * revision — all types: DA, permit/AHJ, utility, as-built. "…Revision Completed"
 * is intentionally excluded (that revision is done). These deals often sit in
 * downstream stages (Construction, Inspection, PTO), which the funnel-bucket
 * sections don't surface — so this is a status scan across all active deals.
 */
const DESIGN_REVISION_STATUS = new Set([
  "Revision Needed - DA Rejected",
  "DA Revision In Progress",
  "Revision Needed - Rejected by AHJ",
  "Permit Revision In Progress",
  "Revision Needed - Rejected by Utility",
  "Utility Revision In Progress",
  "Revision Needed - Rejected",
  "As-Built Revision In Progress",
]);

/** design_status raw values that mean a design is awaiting FINAL review/stamping. */
const DESIGN_FINAL_REVIEW_STATUS = new Set([
  "Ready for Review", // label: Final Review/Stamping
  "DA Approved", // label: Final Design Review
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
      // Revisions and final reviews live in the design_status field and can sit
      // in ANY stage (an as-built revision is in Inspection, a utility revision
      // in PTO) — so scan every active deal by its design_status, not just the
      // design-stage funnel buckets. Join: drill-down deal (has designLead,
      // stage, daysWaiting) ⨝ raw row (has design_status) by id.
      const allDeals: ProjectFunnelDrillDownDeal[] = [
        ...dd.awaitingSurveySchedule, ...dd.awaitingSurvey, ...dd.awaitingDaSend,
        ...dd.awaitingApproval, ...dd.awaitingDesignComplete, ...dd.awaitingPermitSubmit,
        ...dd.awaitingPermitIssue, ...dd.awaitingInterconnection, ...dd.awaitingReadyToBuild,
        ...dd.awaitingConstructionSchedule, ...dd.awaitingConstructionComplete,
        ...dd.awaitingInspection, ...dd.awaitingPto, ...dd.awaitingCloseOut,
      ];
      const designStatusById = new Map(peRows.map((r) => [r.hubspotDealId, r.designStatus]));

      // Build a section from a design_status predicate, showing the design
      // status label on each line (not the bucket's stage-specific status).
      const designStatusSection = (
        title: string,
        match: (rawDesignStatus: string | null) => boolean,
        followUpDays: number | null
      ): DigestSection => {
        const lines = allDeals
          .filter(workable)
          .filter((d) => match(designStatusById.get(String(d.id)) ?? null))
          .map((d) => {
            const line = toLine(d, leadOf(d.designLead), followUpDays);
            line.status = statusLabel("design_status", designStatusById.get(String(d.id)) ?? null);
            return line;
          })
          .sort((a, b) => b.daysWaiting - a.daysWaiting);
        return { title, followUpDays, groupBy: "lead", lines };
      };

      // "Revisions to complete": design_status revision states (any stage) UNION
      // the permit-workflow "back in design" deals (permitting_status) — deduped
      // by id, so a revision surfaced by either signal shows exactly once.
      const revisionLines: DigestLine[] = [];
      const revisionSeen = new Set<string>();
      const pushRevision = (d: ProjectFunnelDrillDownDeal, statusText: string | null) => {
        if (revisionSeen.has(String(d.id))) return;
        revisionSeen.add(String(d.id));
        const line = toLine(d, leadOf(d.designLead), null);
        line.status = statusText;
        revisionLines.push(line);
      };
      for (const d of allDeals.filter(workable)) {
        const ds = designStatusById.get(String(d.id)) ?? null;
        if (ds != null && DESIGN_REVISION_STATUS.has(ds)) pushRevision(d, statusLabel("design_status", ds));
      }
      for (const d of dd.awaitingPermitIssue.filter(workable)) {
        if (d.status != null && PERMIT_DESIGN_REVISION.has(d.status)) pushRevision(d, d.status);
      }
      revisionLines.sort((a, b) => b.daysWaiting - a.daysWaiting);
      const revisions: DigestSection = {
        title: "Revisions to complete",
        followUpDays: null,
        groupBy: "lead",
        lines: revisionLines,
      };
      const finalReviews = designStatusSection(
        "Final design reviews",
        (ds) => ds != null && DESIGN_FINAL_REVIEW_STATUS.has(ds),
        null
      );

      // Deals already surfaced as a revision or final review shouldn't also
      // appear in the generic DA/design-complete sections (no double-listing).
      const claimed = new Set([...revisions.lines, ...finalReviews.lines].map((l) => l.id));
      const notClaimed = (d: ProjectFunnelDrillDownDeal) => !claimed.has(String(d.id));

      return [
        section("DAs to send", dd.awaitingDaSend.filter(notClaimed), (d) => leadOf(d.designLead), null),
        section("Designs to complete", dd.awaitingDesignComplete.filter(notClaimed), (d) => leadOf(d.designLead), null),
        finalReviews,
        revisions,
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

  // Owner tracking space: every live worklist is copied here so the owner can
  // see exactly what each person was sent (the Q&A mirror only covers replies).
  let mirrorSpace: string | null = null;
  if (opts.mode === "live") {
    const row = await prisma.systemConfig.findUnique({ where: { key: "techops_bot_mirror_space" } });
    mirrorSpace = row?.value?.trim() || null;
  }

  for (const w of worklists) {
    const email = emailByName.get(w.person.trim().toLowerCase()) ?? null;
    if (!email) unmatched.push(w.person);
    const base: PersonalSendResult = { person: w.person, email, deals: w.totalDeals, sent: false };

    // Lowercase before testing: emailByName carries User.email as-is, but the
    // excluded set is lowercased — a mixed-case email would slip the guard and
    // (for reps) produce a double DM.
    if (email && excluded.has(email.trim().toLowerCase())) {
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
        // Copy into the owner's tracking space so they can see what was sent.
        if (mirrorSpace && mirrorSpace !== space) {
          await postGoogleChatMessage({
            spaceName: mirrorSpace,
            text: `📋 Worklist → ${w.person}${email ? ` <${email}>` : ""} (${w.totalDeals} deals):\n\n${message}`,
          }).catch((e) => console.warn("[worklists] mirror copy failed:", e));
        }
        results.push({ ...base, sent: true });
      }
    } catch (e) {
      results.push({ ...base, reason: e instanceof Error ? e.message.slice(0, 200) : "send failed" });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { results, unmatched };
}

// ---------------------------------------------------------------------------
// Manager worklists — cross-team ROLLUPS for a manager (not the per-person
// pivot). Config: SystemConfig `bottleneck_manager_worklists` = JSON array of
// { email, view }. Views: "da_pending_sales_changes" = every deal with
// layout_status "Pending Sales Changes", grouped by sales rep (owner).
// ---------------------------------------------------------------------------

interface ManagerWorklistConfig { email: string; view: string }

function firstNameFromEmail(email: string): string {
  const local = (email.split("@")[0] || email).split(/[._]/)[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

type PscProject = { id: number | string; name: string; amount: number; pbLocation: string; dealOwner: string; layoutStatus: string | null };

/** All "Pending Sales Changes" DAs, grouped by rep, with revenue + deal links. */
function renderDaPendingSalesChanges(
  projects: PscProject[],
  recipientName: string,
  nowMs: number
): { text: string; total: number } {
  const psc = projects.filter((p) => (p.layoutStatus || "") === "Pending Sales Changes");
  const day = new Date(nowMs).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });
  const totalRev = psc.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const byRep = new Map<string, typeof psc>();
  for (const p of psc) {
    const rep = (p.dealOwner || "").trim() || "Unassigned";
    if (!byRep.has(rep)) byRep.set(rep, []);
    byRep.get(rep)!.push(p);
  }
  const reps = [...byRep.entries()]
    .map(([rep, ds]) => ({ rep, ds, rev: ds.reduce((s, p) => s + (Number(p.amount) || 0), 0) }))
    .sort((a, b) => b.rev - a.rev);

  const out: string[] = [
    `👋 ${recipientName} — DAs pending sales changes across the team, ${day}`,
    `${psc.length} deal${psc.length === 1 ? "" : "s"} — $${Math.round(totalRev).toLocaleString()} total, by rep:`,
    "",
  ];
  let used = out.join("\n").length + 200;
  let cut = 0;
  for (const { rep, ds, rev } of reps) {
    const header = `*${rep}* — ${ds.length} deal${ds.length === 1 ? "" : "s"} | $${Math.round(rev).toLocaleString()}`;
    if (used + header.length > CHAT_CHAR_BUDGET) { cut += ds.length; continue; }
    out.push(header); used += header.length + 1;
    for (const p of [...ds].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))) {
      const line = `• ${dealLink(String(p.id), p.name)}${p.pbLocation ? ` (${p.pbLocation})` : ""} — $${Math.round(Number(p.amount) || 0).toLocaleString()}`;
      if (used + line.length > CHAT_CHAR_BUDGET) { cut++; continue; }
      out.push(line); used += line.length + 1;
    }
    out.push(""); used += 1;
  }
  if (cut > 0) out.push(`…${cut} more didn't fit — ask me "list all pending sales changes" for the rest.`);
  return { text: out.join("\n"), total: psc.length };
}

export interface ManagerSendResult {
  email: string;
  total?: number;
  sent?: boolean;
  reason?: string;
  preview?: string;
}

/**
 * Send configured manager rollup worklists. Live delivery reuses the personal-
 * worklist gate (bottleneck_personal_worklists_enabled + recorded DM spaces)
 * and mirrors to the owner tracking space.
 */
export async function runManagerWorklists(opts: {
  mode: "preview" | "live";
  nowMs?: number;
}): Promise<{ results: ManagerSendResult[] }> {
  if (!prisma) return { results: [] };
  const nowMs = opts.nowMs ?? Date.now();

  const cfgRow = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_manager_worklists" } });
  let managers: ManagerWorklistConfig[] = [];
  try {
    const arr = cfgRow?.value ? JSON.parse(cfgRow.value) : [];
    if (Array.isArray(arr)) managers = arr;
  } catch { /* ignore malformed config */ }
  if (managers.length === 0) return { results: [] };

  if (opts.mode === "live") {
    const flag = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_personal_worklists_enabled" } });
    if (flag?.value !== "true") {
      return { results: managers.map((m) => ({ email: m.email, sent: false, reason: "worklists disabled" })) };
    }
  }

  // Active-only projects (excludes terminal/cancelled) — matches exactly what
  // query_projects shows for "pending sales changes", so the daily worklist and
  // the ad-hoc bot answer never disagree.
  const { fetchAllProjects } = await import("@/lib/hubspot");
  const projects = (await fetchAllProjects({ activeOnly: true })) as unknown as PscProject[];

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  const { getUserDmSpaces } = await import("@/lib/tech-ops-bot-proactive");
  const dmSpaces = opts.mode === "live" ? await getUserDmSpaces() : {};
  let mirrorSpace: string | null = null;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: "techops_bot_mirror_space" } });
    mirrorSpace = row?.value?.trim() || null;
  } catch { /* best effort */ }

  const results: ManagerSendResult[] = [];
  for (const m of managers) {
    let rendered: { text: string; total: number };
    if (m.view === "da_pending_sales_changes") {
      rendered = renderDaPendingSalesChanges(projects, firstNameFromEmail(m.email), nowMs);
    } else {
      results.push({ email: m.email, reason: `unknown view "${m.view}"` });
      continue;
    }

    if (opts.mode === "preview") {
      results.push({ email: m.email, total: rendered.total, preview: rendered.text });
      continue;
    }
    const space = dmSpaces[m.email] || dmSpaces[m.email.toLowerCase()];
    if (!space) {
      results.push({ email: m.email, total: rendered.total, sent: false, reason: "no DM space recorded" });
      continue;
    }
    try {
      await postGoogleChatMessage({ spaceName: space, text: rendered.text });
      if (mirrorSpace && mirrorSpace !== space) {
        await postGoogleChatMessage({
          spaceName: mirrorSpace,
          text: `📋 Manager worklist → ${m.email} (${rendered.total} deals):\n\n${rendered.text}`,
        }).catch((e) => console.warn("[manager-worklists] mirror failed:", e));
      }
      results.push({ email: m.email, total: rendered.total, sent: true });
    } catch (e) {
      results.push({ email: m.email, total: rendered.total, sent: false, reason: e instanceof Error ? e.message.slice(0, 160) : "send failed" });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rep worklists — a per-sales-rep daily digest scoped to their OWN deals.
//
// Sales reps are blocked from company aggregates in the bot; this is their
// proactive counterpart: four sections of things only they can move forward.
// Unlike the personal worklists (mirror-backed funnel buckets), reps need the
// reason NOTES — what change to communicate, why a deal is on hold, which PE
// doc was kicked back — which only live in HubSpot. So this path pulls live
// projects + one PE-docs scan per run and slices them per rep.
//
// Reps are excluded from runPersonalWorklists (the cron passes the roster as
// `exclude`) so nobody gets two DMs: this worklist is the superset.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PE documents a rep sees — SALES-owned ONLY. Reps must never see another
 * team's PE rejections, so this is restricted to the customer-facing package
 * Sales owns. Labels are the canonical names in PE_DOC_TO_TEAM_FIELD
 * (pe-rejection-notes.ts); the assertion below fails the build if any entry is
 * not actually routed to Sales, so the two can't drift apart.
 */
const REP_PE_DOCS: Array<{ prop: string; label: string }> = [
  { prop: "pe_doc_customer_agreement", label: "Customer Agreement (PPA/ESA)" },
  { prop: "pe_doc_signed_proposal", label: "Signed Proposal" },
  { prop: "pe_doc_state_disclosures", label: "State Disclosures" },
  { prop: "pe_doc_installation_order", label: "Installation Order" },
  { prop: "pe_doc_utility_bill", label: "Utility Bill" },
];
// Guard: every rep-visible PE doc must be Sales-owned per the canonical map.
const NON_SALES_REP_DOC = REP_PE_DOCS.find(
  (d) => PE_DOC_TO_TEAM_FIELD[d.label] !== "pe_rejection_notes_for_sales"
);
if (NON_SALES_REP_DOC) {
  throw new Error(
    `REP_PE_DOCS includes a non-Sales PE doc: "${NON_SALES_REP_DOC.label}" ` +
      `(routes to ${PE_DOC_TO_TEAM_FIELD[NON_SALES_REP_DOC.label] ?? "unknown"})`
  );
}

type RepPeDeal = {
  id: string;
  name: string;
  pbLocation: string;
  docs: Array<{ label: string; note: string | null }>;
};

/**
 * All PE-pipeline deals with at least one document in "Action Required",
 * grouped by HubSpot owner id. One paginated scan for the whole run; each rep
 * gets their slice by owner id (never by name — avoids the Roland/Rolando trap).
 */
async function fetchPeDocsActionRequiredByOwner(): Promise<Map<string, RepPeDeal[]>> {
  const { searchWithRetry } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import("@hubspot/api-client/lib/codegen/crm/deals");
  const props = [
    "dealname", "hubspot_owner_id", "pb_location", "pe_m1_status",
    ...REP_PE_DOCS.map((d) => d.prop),
    ...REP_PE_DOCS.map((d) => `${d.prop}_notes`),
  ];
  const rows: Array<Record<string, string | null | undefined> & { __hsid: string }> = [];
  let after: string | undefined;
  const PAGE_CAP = 30; // 30 × 200 = 6,000 PE deals
  for (let page = 0; page < PAGE_CAP; page++) {
    const req: { filterGroups: { filters: unknown[] }[]; properties: string[]; limit: number; after?: string } = {
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
            { propertyName: "pe_m1_status", operator: FilterOperatorEnum.HasProperty },
          ],
        },
      ],
      properties: props,
      limit: 200,
    };
    if (after) req.after = after;
    const res = await searchWithRetry(req as Parameters<typeof searchWithRetry>[0]);
    for (const d of res.results) rows.push({ ...(d.properties ?? {}), __hsid: d.id });
    after = res.paging?.next?.after;
    if (!after) break;
    if (page === PAGE_CAP - 1) {
      console.warn(`[rep-worklists] PE-docs scan hit the ${PAGE_CAP}-page cap (${rows.length} deals) — some reps' PE section may be incomplete.`);
    }
  }

  // HubSpot select fields store the internal VALUE ("action_required"), not the
  // label ("Action Required") — normalize both sides before comparing.
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");
  const want = norm("action_required");
  const byOwner = new Map<string, RepPeDeal[]>();
  for (const r of rows) {
    const ownerId = String(r.hubspot_owner_id || "").trim();
    if (!ownerId) continue;
    const docs: Array<{ label: string; note: string | null }> = [];
    for (const d of REP_PE_DOCS) {
      const st = r[d.prop] ? String(r[d.prop]) : "";
      if (st && norm(st) === want) {
        const noteRaw = r[`${d.prop}_notes`];
        docs.push({ label: d.label, note: noteRaw ? String(noteRaw) : null });
      }
    }
    if (docs.length === 0) continue;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId)!.push({
      id: r.__hsid,
      name: String(r.dealname || "(unnamed)"),
      pbLocation: String(r.pb_location || ""),
      docs,
    });
  }
  return byOwner;
}

/** Roster of rep emails from SystemConfig `bottleneck_rep_worklists`
 *  (JSON array of email strings). Empty/absent → no rep worklists run. */
export async function getRepWorklistRoster(): Promise<string[]> {
  if (!prisma) return [];
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_rep_worklists" } });
    const arr = row?.value ? JSON.parse(row.value) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface RepSendResult {
  email: string;
  name?: string;
  total?: number;
  sent?: boolean;
  reason?: string;
  preview?: string;
}

/** Collapse whitespace and cap a note so one deal never floods the digest. */
function repNote(s: string | null | undefined, max = 140): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * One rep's four-section worklist, scoped to their own deals. `projects` must
 * already be filtered to this rep (by owner name); `pe` to this rep (by owner id).
 */
function renderRepWorklist(
  repName: string,
  projects: Project[],
  pe: RepPeDeal[],
  surveyEligibleStages: readonly string[],
  nowMs: number
): { text: string; total: number } {
  const day = new Date(nowMs).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });
  const loc = (p: Project) => (p.pbLocation ? ` (${p.pbLocation})` : "");

  const pendingSalesChanges = projects.filter((p) => (p.layoutStatus || "") === "Pending Sales Changes");
  // Survey-eligible stage with no survey scheduled yet — the scheduler's own
  // definition (`resolveMilestones`), so this never disagrees with the calendar.
  const surveysToSchedule = projects.filter(
    (p) => surveyEligibleStages.includes(p.stage) && !resolveMilestones(p).hasSurveyScheduled
  );
  const onHold = projects.filter((p) => p.stage === "On Hold");

  const sections: Array<{ title: string; lines: string[] }> = [];
  if (pendingSalesChanges.length) {
    sections.push({
      title: `📝 Pending sales changes — reach the customer (${pendingSalesChanges.length})`,
      lines: pendingSalesChanges.map((p) => {
        const note = repNote(p.salesChangeOrderNotes);
        return `• ${dealLink(String(p.id), p.name)}${loc(p)}${note ? ` — ${note}` : ""}`;
      }),
    });
  }
  if (surveysToSchedule.length) {
    sections.push({
      title: `📅 Surveys to schedule (${surveysToSchedule.length})`,
      lines: surveysToSchedule.map((p) => {
        const st = p.siteSurveyStatus ? statusLabel("site_survey_status", p.siteSurveyStatus) : "";
        return `• ${dealLink(String(p.id), p.name)}${loc(p)}${st ? ` — ${st}` : ""}`;
      }),
    });
  }
  if (pe.length) {
    sections.push({
      title: `📄 PE rejections — sales docs to fix (${pe.length})`,
      lines: pe.map((d) => {
        const docs = d.docs.map((x) => x.label).join(", ");
        const firstNote = repNote(d.docs.find((x) => x.note)?.note);
        return `• ${dealLink(d.id, d.name)}${d.pbLocation ? ` (${d.pbLocation})` : ""} — ${docs}${firstNote ? `: ${firstNote}` : ""}`;
      }),
    });
  }
  if (onHold.length) {
    sections.push({
      title: `⏸️ On-hold — follow up (${onHold.length})`,
      lines: onHold.map((p) => {
        const reason = repNote([p.onHoldReason, p.onHoldNotes].filter(Boolean).join(" — "));
        return `• ${dealLink(String(p.id), p.name)}${loc(p)}${reason ? ` — ${reason}` : ""}`;
      }),
    });
  }

  const total = pendingSalesChanges.length + surveysToSchedule.length + pe.length + onHold.length;
  const first = repName.split(" ")[0] || repName;
  const out: string[] = [
    `👋 ${first} — your worklist for ${day}`,
    total === 0
      ? "You're all clear — nothing needs your attention right now. 🎉"
      : `${total} item${total === 1 ? "" : "s"} need your attention:`,
    "",
  ];
  let used = out.join("\n").length + 200;
  let cut = 0;
  for (const s of sections) {
    if (used + s.title.length > CHAT_CHAR_BUDGET) { cut += s.lines.length; continue; }
    out.push(s.title); used += s.title.length + 1;
    for (const line of s.lines) {
      if (used + line.length > CHAT_CHAR_BUDGET) { cut++; continue; }
      out.push(line); used += line.length + 1;
    }
    out.push(""); used += 1;
  }
  if (cut > 0) out.push(`…${cut} more didn't fit — reply and ask me to list them.`);
  out.push("Reply here anytime to ask about any of your deals.");
  return { text: out.join("\n"), total };
}

/**
 * Send each configured rep their own daily worklist. Live delivery reuses the
 * personal-worklist gate (`bottleneck_personal_worklists_enabled` + recorded DM
 * spaces), honors standing exclusions, and mirrors to the owner tracking space.
 * - preview: JSON summaries + rendered text, nothing posted.
 * - dryrun: every worklist posted to the OWNER DM, labeled (no rep is messaged).
 * - live: real DMs to each rep.
 */
export async function runRepWorklists(opts: {
  mode: "preview" | "dryrun" | "live";
  nowMs?: number;
}): Promise<{ results: RepSendResult[]; roster: string[] }> {
  if (!prisma) return { results: [], roster: [] };
  const nowMs = opts.nowMs ?? Date.now();

  const roster = await getRepWorklistRoster();
  if (roster.length === 0) return { results: [], roster: [] };

  if (opts.mode === "live") {
    const flag = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_personal_worklists_enabled" } });
    if (flag?.value !== "true") {
      return { results: roster.map((email) => ({ email, sent: false, reason: "worklists disabled" })), roster };
    }
  }

  // Standing exclusions (people who must never receive a worklist).
  let standing: string[] = [];
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: "bottleneck_delivery_exclusions" } });
    const arr = row?.value ? JSON.parse(row.value) : [];
    if (Array.isArray(arr)) standing = arr.map((e) => String(e).trim().toLowerCase());
  } catch { /* best effort */ }
  const excluded = new Set(standing);

  const { fetchAllProjects, fetchAllOwnersMinimal, SURVEY_ELIGIBLE_STAGES } = await import("@/lib/hubspot");
  const { resolveOwnerIdByEmail } = await import("@/lib/hubspot-tasks");
  const [projects, owners, peByOwner, users] = await Promise.all([
    fetchAllProjects({ activeOnly: true }),
    fetchAllOwnersMinimal(),
    fetchPeDocsActionRequiredByOwner(),
    prisma.user.findMany({ where: { email: { in: roster } }, select: { email: true, name: true } }),
  ]);

  // email -> canonical HubSpot owner {id, name}. dealOwner on projects is this
  // same name, so slicing by it is exact even when the User table spells it
  // differently. ownerById backs the alias fallback below.
  const ownerByEmail = new Map<string, { id: string; name: string }>();
  const ownerById = new Map<string, string>();
  for (const o of owners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
    ownerById.set(String(o.id), name);
    if (o.email) ownerByEmail.set(o.email.trim().toLowerCase(), { id: String(o.id), name });
  }
  const nameByEmail = new Map(users.filter((u) => u.name).map((u) => [u.email.trim().toLowerCase(), u.name!]));

  // Owner name -> id(s), derived from the deals themselves. Captures reps who
  // are DEACTIVATED in HubSpot's Owners API (so email/alias lookup misses them)
  // but still own active deals — e.g. Ryan Montgomery, 29 deals, no owner row.
  const idsByOwnerName = new Map<string, Set<string>>();
  for (const p of projects) {
    const nm = (p.dealOwner || "").trim().toLowerCase();
    if (!nm || !p.hubspotOwnerId) continue;
    if (!idsByOwnerName.has(nm)) idsByOwnerName.set(nm, new Set());
    idsByOwnerName.get(nm)!.add(p.hubspotOwnerId);
  }

  // Resolve a rep email to their HubSpot owner {id, name}, in order:
  //   1. exact owner-email match, 2. first.last@domain alias (the bot's own
  //   rep-scoping path), 3. deactivated-owner fallback — match the User's
  //   display name to deal owners. An ambiguous name (two owners share it)
  //   returns null so a rep can never be shown someone else's deals.
  async function resolveOwner(email: string): Promise<{ id: string; name: string } | null> {
    const direct = ownerByEmail.get(email);
    if (direct) return direct;
    const aliasId = await resolveOwnerIdByEmail(email, nameByEmail.get(email) ?? null);
    if (aliasId) {
      const name = ownerById.get(String(aliasId));
      if (name) return { id: String(aliasId), name };
    }
    const userName = nameByEmail.get(email);
    if (userName) {
      const ids = idsByOwnerName.get(userName.trim().toLowerCase());
      if (ids && ids.size === 1) return { id: [...ids][0], name: userName };
    }
    return null;
  }

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  const { getOwnerDmSpace, getUserDmSpaces } = await import("@/lib/tech-ops-bot-proactive");
  const dmSpaces = opts.mode === "live" ? await getUserDmSpaces() : {};
  let mirrorSpace: string | null = null;
  if (opts.mode !== "preview") {
    const row = await prisma.systemConfig.findUnique({ where: { key: "techops_bot_mirror_space" } });
    mirrorSpace = row?.value?.trim() || null;
  }

  const results: RepSendResult[] = [];
  for (const email of roster) {
    if (excluded.has(email)) {
      results.push({ email, sent: false, reason: "excluded" });
      continue;
    }
    const owner = await resolveOwner(email);
    if (!owner) {
      results.push({ email, sent: false, reason: "no HubSpot owner match" });
      continue;
    }
    // Slice by owner id (not name) so identically-named owners can't cross-leak.
    const mine = projects.filter((p) => p.hubspotOwnerId === owner.id);
    const myPe = peByOwner.get(owner.id) ?? [];
    const rendered = renderRepWorklist(owner.name, mine, myPe, SURVEY_ELIGIBLE_STAGES, nowMs);
    const base: RepSendResult = { email, name: owner.name, total: rendered.total };

    if (opts.mode === "preview") {
      results.push({ ...base, preview: rendered.text });
      continue;
    }
    // Nothing to say — skip rather than DM an empty worklist.
    if (rendered.total === 0) {
      results.push({ ...base, sent: false, reason: "no items" });
      continue;
    }

    try {
      if (opts.mode === "dryrun") {
        const ownerSpace = await getOwnerDmSpace();
        if (!ownerSpace) { results.push({ ...base, sent: false, reason: "owner DM space missing" }); continue; }
        await postGoogleChatMessage({
          spaceName: ownerSpace,
          text: `🧪 TEST — would DM ${owner.name} <${email}> (${rendered.total} items)\n\n${rendered.text}`,
          skipMirror: true,
        });
        results.push({ ...base, sent: true });
      } else {
        const space = dmSpaces[email] || dmSpaces[email.toLowerCase()];
        if (!space) { results.push({ ...base, sent: false, reason: "no DM space recorded" }); continue; }
        await postGoogleChatMessage({ spaceName: space, text: rendered.text, skipMirror: true });
        if (mirrorSpace && mirrorSpace !== space) {
          await postGoogleChatMessage({
            spaceName: mirrorSpace,
            text: `🧾 Rep worklist → ${owner.name} <${email}> (${rendered.total} items):\n\n${rendered.text}`,
            skipMirror: true,
          }).catch((e) => console.warn("[rep-worklists] mirror failed:", e));
        }
        results.push({ ...base, sent: true });
      }
    } catch (e) {
      results.push({ ...base, sent: false, reason: e instanceof Error ? e.message.slice(0, 160) : "send failed" });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { results, roster };
}
