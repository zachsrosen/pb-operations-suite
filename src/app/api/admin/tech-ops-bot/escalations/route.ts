/**
 * GET /api/admin/tech-ops-bot/escalations
 * PATCH /api/admin/tech-ops-bot/escalations
 * POST /api/admin/tech-ops-bot/escalations  — apply a correction to the playbook
 *
 * Admin-only endpoint for reviewing Tech Ops bot escalations.
 * GET: list pending escalations
 * PATCH: resolve/dismiss an escalation
 * POST: { id } — fold a [CORRECTION] row into the bot's playbook (so the bot
 *   respects it immediately) and mark it resolved.
 *
 * Covered by ADMIN_ONLY_ROUTES prefix check in middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const LEARNED_SECTION = "## Learned Corrections";

export async function GET() {
  const escalations = await prisma.techOpsBotEscalation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ escalations, count: escalations.length });
}

export async function PATCH(request: NextRequest) {
  let body: { id?: string; status?: string; resolvedNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  if (!["RESOLVED", "DISMISSED"].includes(body.status)) {
    return NextResponse.json(
      { error: "status must be RESOLVED or DISMISSED" },
      { status: 400 }
    );
  }

  const updated = await prisma.techOpsBotEscalation.update({
    where: { id: body.id },
    data: {
      status: body.status,
      resolvedNote: body.resolvedNote ?? null,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({ escalation: updated });
}

/**
 * POST — apply a logged correction to the bot's playbook.
 * Body: { id }. Appends the correction (topic + correct info) under a
 * "## Learned Corrections" section in the OooBotConfig playbook so the bot
 * picks it up on the next message, then marks the correction resolved.
 */
export async function POST(request: NextRequest) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const row = await prisma.techOpsBotEscalation.findUnique({
    where: { id: body.id },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.question.startsWith("[CORRECTION]")) {
    return NextResponse.json(
      { error: "Only corrections can be applied to the playbook" },
      { status: 400 }
    );
  }

  // Pull the corrected info out of the stored context ("WRONG: ...\nCORRECT: ...")
  const topic = row.question.replace("[CORRECTION]", "").trim() || "Correction";
  const correctMatch = (row.botContext ?? "").match(/CORRECT:\s*([\s\S]*)/i);
  const correctInfo = (correctMatch?.[1] ?? row.botContext ?? "").trim();
  const entry = `- **${topic}:** ${correctInfo}`;

  const config = await prisma.techOpsBotConfig.findFirst();
  if (!config) {
    return NextResponse.json(
      { error: "Bot config not found — can't apply to playbook" },
      { status: 500 }
    );
  }

  const current = (config.playbook ?? "").trimEnd();
  const newPlaybook = current.includes(LEARNED_SECTION)
    ? `${current}\n${entry}\n`
    : current
      ? `${current}\n\n${LEARNED_SECTION}\n${entry}\n`
      : `${LEARNED_SECTION}\n${entry}\n`;

  await prisma.techOpsBotConfig.update({
    where: { id: config.id },
    data: { playbook: newPlaybook },
  });

  const resolved = await prisma.techOpsBotEscalation.update({
    where: { id: row.id },
    data: {
      status: "RESOLVED",
      resolvedNote: "Applied to playbook",
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({ escalation: resolved, appliedEntry: entry });
}
