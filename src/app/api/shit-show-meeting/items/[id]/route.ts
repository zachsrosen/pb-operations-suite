import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { applyDecision, type ShitShowDecisionValue } from "@/lib/shit-show/decision";

const ALLOWED_FIELDS = new Set(["meetingNotes"]);

const VALID_DECISIONS: ReadonlySet<ShitShowDecisionValue> = new Set([
  "RESOLVED",
  "STILL_PROBLEM",
  "ESCALATED",
  "DEFERRED",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json()) as Record<string, unknown>;

  if (typeof body.decision === "string" && VALID_DECISIONS.has(body.decision as ShitShowDecisionValue)) {
    const item = await prisma.shitShowSessionItem.findUnique({
      where: { id },
      select: { dealId: true, dealName: true, region: true },
    });
    if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

    try {
      await applyDecision({
        itemId: id,
        dealId: item.dealId,
        decision: body.decision as ShitShowDecisionValue,
        decisionRationale: typeof body.decisionRationale === "string"
          ? body.decisionRationale
          : null,
        userEmail: auth.email,
        dealName: item.dealName,
        region: item.region,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "decision_failed" },
        { status: 400 },
      );
    }
  }

  // Plain field updates (just meetingNotes for now)
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) data[key] = value;
  }
  if (Object.keys(data).length > 0) {
    await prisma.shitShowSessionItem.update({ where: { id }, data });
  }

  const updated = await prisma.shitShowSessionItem.findUnique({
    where: { id },
    include: { assignments: true },
  });
  return NextResponse.json({ item: updated });
}
