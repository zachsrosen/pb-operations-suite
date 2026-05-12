/**
 * GET  /api/zuper-drift?status=open|resolved|ignored|all
 * POST /api/zuper-drift  { id, action: "resolve"|"ignore"|"reopen", note? }
 *
 * Lists and resolves Zuper status drift entries written by the
 * /api/cron/zuper-status-reconcile job. Flag-only — these endpoints
 * do not push corrections to HubSpot or Zuper; the user clicks through
 * to fix.
 *
 * Surfaced in the Project Management suite — PMs are the ones who
 * reconcile, so they get access alongside admin and executive.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { ZuperDriftStatus } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"] as const;

async function requireAccess() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!prisma) {
    return { error: NextResponse.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const user = await getUserByEmail(session.user.email);
  const roles = user?.roles ?? [];
  if (!user || !roles.some((r) => ALLOWED_ROLES.includes(r as typeof ALLOWED_ROLES[number]))) {
    return { error: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  const statusParam = (request.nextUrl.searchParams.get("status") ?? "open").toLowerCase();
  const where: { status?: ZuperDriftStatus } = {};
  if (statusParam === "open") where.status = "OPEN";
  else if (statusParam === "resolved") where.status = "RESOLVED";
  else if (statusParam === "ignored") where.status = "IGNORED";
  // "all" → no filter

  const rows = await prisma!.zuperStatusDrift.findMany({
    where,
    orderBy: [{ detectedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    status: "ok",
    count: rows.length,
    rows,
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  let body: { id?: string; action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, action, note } = body;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing 'id'" }, { status: 400 });
  }

  let nextStatus: ZuperDriftStatus;
  switch (action) {
    case "resolve":
      nextStatus = "RESOLVED";
      break;
    case "ignore":
      nextStatus = "IGNORED";
      break;
    case "reopen":
      nextStatus = "OPEN";
      break;
    default:
      return NextResponse.json(
        { error: "action must be 'resolve' | 'ignore' | 'reopen'" },
        { status: 400 },
      );
  }

  try {
    const updated = await prisma!.zuperStatusDrift.update({
      where: { id },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === "OPEN" ? null : new Date(),
        resolvedBy: nextStatus === "OPEN" ? null : gate.user.email,
        resolveNote: note?.slice(0, 500) ?? null,
      },
    });
    return NextResponse.json({ status: "ok", row: updated });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message.includes("Record to update not found")
            ? "Drift record not found"
            : "Update failed",
      },
      { status: 404 },
    );
  }
}
