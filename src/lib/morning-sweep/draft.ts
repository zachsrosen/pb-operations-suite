// src/lib/morning-sweep/draft.ts
//
// The value-add over a plain digest: hand the gathered data to Claude and get
// back (a) a ranked "do these first" list across all sources, and (b) casual
// draft replies for the Freshservice tickets waiting on Zach. Best-effort —
// if Claude is unavailable or returns junk, the digest still ships the raw data.

import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import type { SweepData, SweepDrafts } from "./types";

const SYSTEM = [
  "You are Zach's chief of staff at Photon Brothers, a residential solar installer.",
  "You help him get ahead of his tasks and tickets each morning.",
  "Tone: casual, brief, human. Photon Brothers resolves tickets with short casual replies, not formal notes.",
  "Never use em dashes. Use commas, periods, or colons instead.",
  "Return ONLY a single valid JSON object, no prose, no code fences.",
].join(" ");

function buildUserPrompt(data: SweepData): string {
  const tasks = {
    overdue: data.tasks.overdue.map((t) => ({
      subject: t.subject,
      priority: t.priority,
    })),
    today: data.tasks.today.map((t) => t.subject),
    batches: data.tasks.groups.map((g) => `${g.label} (x${g.count}, ${g.priority || "no"} priority)`),
  };
  const tickets = data.freshservice.waitingOnMe.map((t) => ({
    id: t.id,
    subject: t.subject,
    priority: t.priority,
    ageDays: t.ageDays,
    detail: t.descriptionSnippet,
  }));
  const pe = {
    actionRequiredDeals: data.pe.actionRequiredDealCount,
    top: data.pe.topDeals.map((d) => `${d.dealName}: ${d.docs.join(", ")}`),
  };
  const email = data.email.connected
    ? data.email.items.map((e) => `${e.isMeetingNote ? "[meeting] " : ""}${e.subject} (${e.ageDays}d)`)
    : [];

  return [
    "Here is this morning's data across Zach's sources. Produce JSON with exactly two keys:",
    '  "topPriorities": an array of 3 to 5 short strings, the highest-leverage things to do first today, ranked, drawing across ALL sources. Call out anything blocking other people, money/SLA exposure, or items that appear in more than one source.',
    '  "ticketReplies": an object mapping each Freshservice ticket id (as a string) to a short casual reply (1 to 3 sentences) that unblocks it. For vague tickets, ask for the specific missing detail. Only include tickets listed below.',
    "",
    "DATA:",
    JSON.stringify({ tasks, tickets, pe, email }, null, 2),
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function draftPrep(data: SweepData): Promise<SweepDrafts | null> {
  // Nothing to reason about — skip the call.
  if (
    data.tasks.totalOpen === 0 &&
    data.freshservice.waitingOnMe.length === 0 &&
    data.pe.actionRequiredDealCount === 0
  ) {
    return null;
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserPrompt(data) }],
    });
    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text"
    );
    const raw = textBlock?.text ?? "";
    const parsed = extractJson(raw) as {
      topPriorities?: unknown;
      ticketReplies?: unknown;
    } | null;
    if (!parsed) return null;

    const topPriorities = Array.isArray(parsed.topPriorities)
      ? parsed.topPriorities.filter((x): x is string => typeof x === "string")
      : [];
    const ticketReplies: Record<string, string> = {};
    if (parsed.ticketReplies && typeof parsed.ticketReplies === "object") {
      for (const [k, v] of Object.entries(parsed.ticketReplies as Record<string, unknown>)) {
        if (typeof v === "string") ticketReplies[k] = v;
      }
    }
    return { topPriorities, ticketReplies };
  } catch {
    // Claude is best-effort; the digest still ships without drafts.
    return null;
  }
}
