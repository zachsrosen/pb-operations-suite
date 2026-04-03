import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { appCache } from "@/lib/cache";

/**
 * GET /api/idr-meeting/escalation-queue
 * Returns all QUEUED escalation items (pending for the next session).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await prisma.idrEscalationQueue.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ items });
}

/**
 * POST /api/idr-meeting/escalation-queue
 * Add a deal to the escalation queue.
 * Body: { dealId, dealName, region?, reason }
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { dealId, dealName, region, reason, queueType, ...prefill } = body;

  if (!dealId || !dealName || !reason) {
    return NextResponse.json(
      { error: "dealId, dealName, and reason are required" },
      { status: 400 },
    );
  }

  const resolvedType = "ESCALATION";

  // Check for existing queued entry for same deal
  const existing = await prisma.idrEscalationQueue.findFirst({
    where: { dealId, status: "QUEUED" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Deal already queued for escalation", existingId: existing.id },
      { status: 409 },
    );
  }

  // Allowlist for prefilled fields
  const PREFILL_FIELDS = [
    "difficulty", "installerCount", "installerDays", "electricianCount",
    "electricianDays", "discoReco", "interiorAccess",
    "customerNotes", "operationsNotes", "designNotes",
  ];
  const prefillData: Record<string, unknown> = {};
  for (const key of PREFILL_FIELDS) {
    if (key in prefill && prefill[key] != null) prefillData[key] = prefill[key];
  }

  const item = await prisma.idrEscalationQueue.create({
    data: {
      dealId,
      dealName,
      region: region ?? null,
      queueType: resolvedType,
      reason,
      requestedBy: auth.email,
      ...prefillData,
    },
  });

  // Broadcast so other clients see the new escalation in preview
  appCache.invalidate("idr-meeting:preview");

  return NextResponse.json(item, { status: 201 });
}
