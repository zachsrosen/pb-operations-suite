// src/lib/morning-sweep/gather.ts
//
// Read-only data gathering for the morning sweep. Each gatherer is defensive:
// a failure in one source is captured as an error string and never aborts the
// others, so the digest still goes out with whatever was reachable.

import { prisma } from "@/lib/db";
import {
  resolveOwnerIdByEmail,
  fetchOpenTasksByOwner,
  type HubSpotTask,
} from "@/lib/hubspot-tasks";
import {
  fetchAgentIdByEmail,
  fetchTicketsByAgentId,
  fetchRequesterIdByEmail,
  fetchTicketsByRequesterId,
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
  type FreshserviceTicket,
} from "@/lib/freshservice";
import { fetchGmailPage } from "@/lib/comms-gmail";
import { hubspotClient } from "@/lib/hubspot";
import { PeDocStatus } from "@/generated/prisma/enums";
import type {
  SweepTasks,
  SweepTaskItem,
  SweepTaskGroup,
  SweepFreshservice,
  SweepTicket,
  SweepPe,
  SweepPeDeal,
  SweepEmail,
  SweepEmailItem,
  TaskBucket,
} from "./types";

const ZACH_EMAIL = "zach@photonbrothers.com";
const ZACH_NAME = "Zach Rosen";
const FRESHSERVICE_DOMAIN = process.env.FRESHSERVICE_DOMAIN || "photonbrothers";

// ── Date helpers (Denver-local) ────────────────────────────────────────────

const DENVER = "America/Denver";

/** Today's date as YYYY-MM-DD in Denver. */
export function denverToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DENVER }).format(new Date());
}

/** Convert an ISO timestamp to its Denver-local YYYY-MM-DD. */
function denverDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DENVER }).format(new Date(iso));
}

function ageInDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ── HubSpot tasks ───────────────────────────────────────────────────────────

/**
 * Collapse the noise the Tech Ops bot generates:
 *  - recurring duplicates (same subject recreated daily) → one item w/ count
 *  - templated batches (one PROJ each, differing subjects) → one grouped row
 * Everything else is bucketed individually by due date.
 */
function familyKey(subject: string): string {
  return (subject || "")
    .replace(/PROJ-?\d+/gi, "")
    .replace(/#\d+/g, "")
    .replace(/\b\d{3,}\b/g, "")
    .replace(/-\s*ZRS\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bucketFor(dueAt: string | null, today: string): TaskBucket {
  if (!dueAt) return "upcoming";
  const d = denverDate(dueAt);
  if (d < today) return "overdue";
  if (d === today) return "today";
  return "upcoming";
}

function priorityRank(p: HubSpotTask["priority"]): number {
  return p === "HIGH" ? 3 : p === "MEDIUM" ? 2 : p === "LOW" ? 1 : 0;
}

export function categorizeTasks(tasks: HubSpotTask[], today: string): SweepTasks {
  const families = new Map<string, HubSpotTask[]>();
  for (const t of tasks) {
    const key = familyKey(t.subject || "");
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(t);
  }

  const overdue: SweepTaskItem[] = [];
  const todayItems: SweepTaskItem[] = [];
  const upcoming: SweepTaskItem[] = [];
  const groups: SweepTaskGroup[] = [];

  const toItem = (t: HubSpotTask): SweepTaskItem => ({
    id: t.id,
    subject: (t.subject || "(no subject)").replace(/\s*-\s*ZRS\s*$/i, "").trim(),
    priority: t.priority,
    dueAt: t.dueAt,
    bucket: bucketFor(t.dueAt, today),
    url: t.hubspotUrl,
  });

  const place = (item: SweepTaskItem) => {
    if (item.bucket === "overdue") overdue.push(item);
    else if (item.bucket === "today") todayItems.push(item);
    else upcoming.push(item);
  };

  const byDueRaw = (a: HubSpotTask, b: HubSpotTask) =>
    (a.dueAt || "9999").localeCompare(b.dueAt || "9999");

  for (const group of families.values()) {
    if (group.length >= 3) {
      // 3+ same-shape tasks: one counted row. Carry the highest priority and
      // earliest due so an urgent recurring item still stands out.
      const sorted = [...group].sort(byDueRaw);
      const sample = sorted[0];
      const top = group.reduce((a, b) => (priorityRank(b.priority) > priorityRank(a.priority) ? b : a));
      const label = familyKey(sample.subject || "")
        .replace(/[\s:—–-]+$/, "")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      groups.push({
        label: label || "(templated tasks)",
        count: group.length,
        priority: top.priority,
        earliestDue: sample.dueAt,
        sampleUrl: sample.hubspotUrl,
      });
    } else {
      for (const t of group) place(toItem(t));
    }
  }

  const byDue = (a: SweepTaskItem, b: SweepTaskItem) =>
    priorityRank(b.priority) - priorityRank(a.priority) ||
    (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
  overdue.sort(byDue);
  todayItems.sort(byDue);
  upcoming.sort(byDue);
  groups.sort(
    (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.count - a.count
  );

  return {
    overdue,
    today: todayItems,
    upcoming,
    groups,
    totalOpen: tasks.length,
  };
}

export async function gatherTasks(errors: string[]): Promise<SweepTasks> {
  const empty: SweepTasks = { overdue: [], today: [], upcoming: [], groups: [], totalOpen: 0 };
  try {
    const ownerId = await resolveOwnerIdByEmail(ZACH_EMAIL, ZACH_NAME);
    if (!ownerId) {
      errors.push("HubSpot tasks: could not resolve owner id for " + ZACH_EMAIL);
      return empty;
    }
    const tasks = await fetchOpenTasksByOwner(ownerId);
    return categorizeTasks(tasks, denverToday());
  } catch (err) {
    errors.push("HubSpot tasks: " + (err instanceof Error ? err.message : String(err)));
    return empty;
  }
}

// ── Freshservice ─────────────────────────────────────────────────────────────

function ticketUrl(id: number): string {
  return `https://${FRESHSERVICE_DOMAIN}.freshservice.com/a/tickets/${id}`;
}

function activeOnly(tickets: FreshserviceTicket[]): FreshserviceTicket[] {
  // Open (2) or Pending (3) only — Resolved/Closed are done.
  return tickets.filter((t) => t.status === 2 || t.status === 3);
}

export function shapeWaiting(assigned: FreshserviceTicket[]): SweepTicket[] {
  const toSweep = (t: FreshserviceTicket): SweepTicket => ({
    id: t.id,
    subject: t.subject,
    status: FRESHSERVICE_STATUS_LABELS[t.status] || String(t.status),
    priority: FRESHSERVICE_PRIORITY_LABELS[t.priority] || String(t.priority),
    priorityRank: t.priority,
    ageDays: ageInDays(t.updated_at),
    descriptionSnippet: (t.description_text || "").replace(/\s+/g, " ").trim().slice(0, 400),
    url: ticketUrl(t.id),
  });

  return activeOnly(assigned)
    .map(toSweep)
    .sort((a, b) => b.priorityRank - a.priorityRank || b.ageDays - a.ageDays);
}

export async function gatherFreshservice(errors: string[]): Promise<SweepFreshservice> {
  const empty: SweepFreshservice = { waitingOnMe: [], selfRaisedCount: 0 };
  try {
    const agentId = await fetchAgentIdByEmail(ZACH_EMAIL);
    if (!agentId) {
      errors.push("Freshservice: no agent found for " + ZACH_EMAIL);
      return empty;
    }

    // Assigned to Zach = people waiting on him. (The agent_id filter only
    // returns tickets where he is the assignee, so all of these are his.)
    const assigned = await fetchTicketsByAgentId(agentId);
    const waitingOnMe = shapeWaiting(assigned);

    // His own backlog = tickets he raised that aren't already assigned to him.
    let selfRaisedCount = 0;
    try {
      const requesterId = await fetchRequesterIdByEmail(ZACH_EMAIL);
      if (requesterId) {
        const raised = activeOnly(await fetchTicketsByRequesterId(requesterId));
        const assignedIds = new Set(assigned.map((t) => t.id));
        selfRaisedCount = raised.filter((t) => !assignedIds.has(t.id)).length;
      }
    } catch (err) {
      errors.push(
        "Freshservice self-raised count: " + (err instanceof Error ? err.message : String(err))
      );
    }

    return { waitingOnMe, selfRaisedCount };
  } catch (err) {
    errors.push("Freshservice: " + (err instanceof Error ? err.message : String(err)));
    return empty;
  }
}

// ── PE action-required docs ──────────────────────────────────────────────────

export async function gatherPe(errors: string[]): Promise<SweepPe> {
  try {
    const docs = await prisma.peDocumentReview.findMany({
      where: { status: { in: [PeDocStatus.ACTION_REQUIRED, PeDocStatus.REJECTED] } },
      select: { dealId: true, docName: true },
    });

    const byDeal = new Map<string, string[]>();
    for (const d of docs) {
      if (!byDeal.has(d.dealId)) byDeal.set(d.dealId, []);
      byDeal.get(d.dealId)!.push(d.docName);
    }

    const ranked = [...byDeal.entries()]
      .map(([dealId, docNames]) => ({ dealId, docs: docNames }))
      .sort((a, b) => b.docs.length - a.docs.length)
      .slice(0, 8);

    // Resolve names from HubSpot (the PE deal ids aren't in the project cache).
    const nameMap = new Map<string, string>();
    try {
      if (ranked.length) {
        const resp = await hubspotClient.crm.deals.batchApi.read({
          inputs: ranked.map((d) => ({ id: d.dealId })),
          properties: ["dealname"],
          propertiesWithHistory: [],
        });
        for (const deal of resp.results) {
          if (deal.properties.dealname) nameMap.set(String(deal.id), deal.properties.dealname);
        }
      }
    } catch (err) {
      errors.push("PE deal names: " + (err instanceof Error ? err.message : String(err)));
    }

    const topDeals: SweepPeDeal[] = ranked.map((d) => ({
      dealId: d.dealId,
      dealName: nameMap.get(d.dealId) || `Deal ${d.dealId}`,
      issueCount: d.docs.length,
      docs: d.docs,
    }));

    return { actionRequiredDealCount: byDeal.size, topDeals };
  } catch (err) {
    errors.push("PE docs: " + (err instanceof Error ? err.message : String(err)));
    return { actionRequiredDealCount: 0, topDeals: [] };
  }
}

// ── Email / meeting follow-ups (conditional on connected Gmail) ───────────────

export async function gatherEmail(errors: string[]): Promise<SweepEmail> {
  try {
    const user = await prisma.user.findUnique({
      where: { email: ZACH_EMAIL },
      select: { id: true },
    });
    if (!user) {
      return { connected: false, unavailableReason: "no PB user record", items: [] };
    }
    const token = await prisma.commsGmailToken.findUnique({
      where: { userId: user.id },
      select: { userId: true },
    });
    if (!token) {
      return {
        connected: false,
        unavailableReason:
          "Gmail not connected. Connect your inbox once in the app (Comms) to enable this section.",
        items: [],
      };
    }

    const items: SweepEmailItem[] = [];

    // Unread threads from a real person in the last week.
    const unread = await fetchGmailPage(user.id, {
      query: "is:unread newer_than:7d -category:promotions -category:social",
      maxResults: 15,
    });
    if ("data" in unread && unread.data) {
      for (const m of unread.data.messages) {
        if (!m.isUnread) continue;
        items.push({
          subject: m.subject || "(no subject)",
          from: m.from || m.fromEmail,
          ageDays: ageInDays(m.date),
          isMeetingNote: false,
        });
      }
    }

    // Meeting action items from Gemini notes.
    const notes = await fetchGmailPage(user.id, {
      query: "from:gemini-notes@google.com newer_than:14d",
      maxResults: 10,
    });
    if ("data" in notes && notes.data) {
      for (const m of notes.data.messages) {
        items.push({
          subject: m.subject || "(meeting notes)",
          from: m.from || m.fromEmail,
          ageDays: ageInDays(m.date),
          isMeetingNote: true,
        });
      }
    }

    items.sort((a, b) => a.ageDays - b.ageDays);
    return { connected: true, items: items.slice(0, 15) };
  } catch (err) {
    errors.push("Email: " + (err instanceof Error ? err.message : String(err)));
    return { connected: false, unavailableReason: "fetch failed", items: [] };
  }
}
