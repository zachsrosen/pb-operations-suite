import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { appCache } from "@/lib/cache";

/**
 * POST /api/idr-meeting/prep
 * Save preview-mode field edits for a deal. Upserts a PREP record in the
 * escalation queue table, which gets consumed when a session starts.
 *
 * Body: { dealId, dealName, region?, ...fieldUpdates }
 */

const PREP_FIELDS = [
  "difficulty", "installerCount", "installerDays", "electricianCount",
  "electricianDays", "discoReco", "interiorAccess",
  "needsSurveyInfo", "needsResurvey", "salesChangeRequested",
  "salesChangeNotes", "opsChangeNotes",
  "customerNotes", "customerNotesCreateTask", "operationsNotes", "designNotes", "conclusion",
  // Adders
  "adderTileRoof", "adderMetalRoof", "adderFlatFoamRoof", "adderShakeRoof",
  "adderSteepPitch", "adderTwoStorey", "adderTrenching", "adderGroundMount",
  "adderMpuUpgrade", "adderEvCharger", "customAdders",
] as const;

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { dealId, dealName, region } = body;

  if (!dealId || !dealName) {
    return NextResponse.json({ error: "dealId and dealName are required" }, { status: 400 });
  }

  // Pick only allowed fields
  const updates: Record<string, unknown> = {};
  for (const key of PREP_FIELDS) {
    if (key in body && body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  // Validate customAdders if present
  if (updates.customAdders !== undefined) {
    if (!Array.isArray(updates.customAdders)) {
      return NextResponse.json({ error: "customAdders must be an array" }, { status: 400 });
    }
    if ((updates.customAdders as unknown[]).length > 20) {
      return NextResponse.json({ error: "Maximum 20 custom adders" }, { status: 400 });
    }
    for (const adder of updates.customAdders as unknown[]) {
      if (adder == null || typeof adder !== "object") {
        return NextResponse.json({ error: "Each custom adder must be an object" }, { status: 400 });
      }
      const a = adder as Record<string, unknown>;
      if (!a.name || typeof a.name !== "string" || a.name.trim().length === 0 || a.name.length > 100) {
        return NextResponse.json({ error: "Each custom adder must have a name (max 100 chars)" }, { status: 400 });
      }
      if (typeof a.amount !== "number" || !isFinite(a.amount)) {
        return NextResponse.json({ error: "Each custom adder must have a numeric amount" }, { status: 400 });
      }
    }
  }

  // Upsert: find existing PREP record for this deal, or create one
  const existing = await prisma.idrEscalationQueue.findFirst({
    where: { dealId, queueType: "PREP", status: "QUEUED" },
  });

  let record;
  if (existing) {
    record = await prisma.idrEscalationQueue.update({
      where: { id: existing.id },
      data: updates,
    });
  } else {
    record = await prisma.idrEscalationQueue.create({
      data: {
        dealId,
        dealName,
        region: region ?? null,
        queueType: "PREP",
        reason: "",
        requestedBy: auth.email,
        ...updates,
      },
    });
  }

  // Broadcast so other clients in preview mode see the edit
  appCache.invalidate("idr-meeting:preview");

  return NextResponse.json(record);
}
