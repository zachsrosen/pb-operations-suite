/**
 * GET  /api/admin/da-drift?status=open|resolved|ignored|all
 * POST /api/admin/da-drift  { id, action: "resolve"|"ignore"|"reopen", note? }
 *
 * Lists and resolves DA status drift entries written by the
 * /api/cron/pandadoc-da-reconcile job. Flag-only — these endpoints do not
 * push corrections to HubSpot; the admin uses the linked deal URL to fix
 * `layout_status` themselves.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { DaDriftStatus } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE"] as const;

async function requireAdmin() {
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
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const statusParam = (request.nextUrl.searchParams.get("status") ?? "open").toLowerCase();
  const where: { status?: DaDriftStatus } = {};
  if (statusParam === "open") where.status = "OPEN";
  else if (statusParam === "resolved") where.status = "RESOLVED";
  else if (statusParam === "ignored") where.status = "IGNORED";
  // "all" → no filter

  const rows = await prisma!.daStatusDrift.findMany({
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
  const gate = await requireAdmin();
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

  let nextStatus: DaDriftStatus;
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
    const updated = await prisma!.daStatusDrift.update({
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
        error: err instanceof Error && err.message.includes("Record to update not found")
          ? "Drift record not found"
          : "Update failed",
      },
      { status: 404 },
    );
  }
}
