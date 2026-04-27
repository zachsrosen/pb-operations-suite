/**
 * Shit Show — end-of-session HubSpot timeline note
 *
 * When a session ends, post one note per discussed item to its deal's HubSpot
 * timeline so non-attendees can see the outcome. Idempotent via stored
 * hubspotNoteId.
 */

import { prisma } from "@/lib/db";

const DEAL_TO_NOTE_ASSOCIATION = 214;

export type EndOfSessionNoteResult = {
  noteId: string | null;
  status: "SYNCED" | "FAILED" | "SKIPPED";
};

const DECISION_LABELS: Record<string, string> = {
  PENDING: "Pending",
  RESOLVED: "Resolved",
  STILL_PROBLEM: "Still a problem",
  ESCALATED: "Escalated",
  DEFERRED: "Deferred",
};

function formatDecision(d: string): string {
  return DECISION_LABELS[d] ?? d;
}

async function postHubspotNote(dealId: string, body: string): Promise<string> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN missing");

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { hs_note_body: body, hs_timestamp: Date.now().toString() },
      associations: [{
        to: { id: dealId },
        types: [{
          associationCategory: "HUBSPOT_DEFINED",
          associationTypeId: DEAL_TO_NOTE_ASSOCIATION,
        }],
      }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`HubSpot note create failed: ${res.status} ${errBody.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Post one HubSpot note per item to its deal's timeline. Idempotent — items
 * with a non-null hubspotNoteId are skipped.
 */
export async function postEndOfSessionNote(itemId: string): Promise<EndOfSessionNoteResult> {
  const item = await prisma.shitShowSessionItem.findUnique({
    where: { id: itemId },
    include: { assignments: true, session: true },
  });
  if (!item) return { noteId: null, status: "FAILED" };
  if (item.hubspotNoteId) return { noteId: item.hubspotNoteId, status: "SKIPPED" };

  const decisionLabel = formatDecision(item.decision);
  const assignments = item.assignments.length === 0
    ? "(none)"
    : item.assignments
        .map((a) => {
          const due = a.dueDate
            ? ` (due ${a.dueDate.toISOString().slice(0, 10)})`
            : "";
          return `- ${a.assigneeUserId}: ${a.actionText}${due}`;
        })
        .join("\n");

  const body = [
    `🔥 Shit Show Meeting — ${item.session.date.toISOString().slice(0, 10)}`,
    "",
    `Decision: ${decisionLabel}`,
    `Decision rationale: ${item.decisionRationale ?? "(none)"}`,
    `Reason at time of meeting: ${item.reasonSnapshot ?? "(none)"}`,
    "",
    "Notes from discussion:",
    item.meetingNotes ?? "(none)",
    "",
    "Follow-ups assigned:",
    assignments,
  ].join("\n");

  try {
    const noteId = await postHubspotNote(item.dealId, body);
    await prisma.shitShowSessionItem.update({
      where: { id: itemId },
      data: { hubspotNoteId: noteId, noteSyncStatus: "SYNCED", noteSyncError: null },
    });
    return { noteId, status: "SYNCED" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.shitShowSessionItem.update({
      where: { id: itemId },
      data: { noteSyncStatus: "FAILED", noteSyncError: msg },
    });
    return { noteId: null, status: "FAILED" };
  }
}

/**
 * End a session: post one note per item, then mark the session COMPLETED.
 * Returns counts. Safe to re-run (notes that already synced are skipped).
 */
export async function endSession(sessionId: string): Promise<{
  posted: number;
  failed: number;
  skipped: number;
}> {
  const items = await prisma.shitShowSessionItem.findMany({ where: { sessionId } });
  let posted = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    const result = await postEndOfSessionNote(item.id);
    if (result.status === "SYNCED") posted += 1;
    else if (result.status === "FAILED") failed += 1;
    else skipped += 1;
  }
  await prisma.shitShowSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED" },
  });
  return { posted, failed, skipped };
}
