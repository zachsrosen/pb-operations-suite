import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin escape hatch for MUTED approval signals (spec §three-strikes: MUTED
 * must be listable and un-mutable). Lives under /api/admin, which the
 * middleware restricts to ADMIN via ADMIN_ONLY_ROUTES; the role check here
 * mirrors sibling admin routes for defense in depth. Deliberately NOT gated
 * on the signals UI flag — the escape hatch must work even if the UI is
 * turned back off with signals already muted.
 */

async function requireAdmin(): Promise<NextResponse | null> {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** GET — MUTED signals plus row counts by status. */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const [muted, grouped] = await Promise.all([
      prisma.approvalSignal.findMany({
        where: { status: "MUTED" },
        orderBy: { detectedAt: "desc" },
      }),
      prisma.approvalSignal.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return NextResponse.json({ muted, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const PostSchema = z.object({
  id: z.string().min(1),
  action: z.literal("unmute"),
});

/**
 * POST { id, action: "unmute" } — MUTED → DISMISSED with dismissCount reset
 * to 2, i.e. one strike left before it mutes again. dismissedMessageIds is
 * trimmed to the newest 2 to keep the applyDismiss invariant
 * (dismissCount = distinct ids) — the next distinct dismissal is the 3rd.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const row = await prisma.approvalSignal.findUnique({
      where: { id: parsed.data.id },
    });
    if (!row) {
      return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    }
    if (row.status !== "MUTED") {
      return NextResponse.json(
        { error: `Signal is ${row.status}, not MUTED` },
        { status: 409 },
      );
    }
    const updated = await prisma.approvalSignal.update({
      where: { id: row.id },
      data: {
        status: "DISMISSED",
        dismissCount: 2,
        dismissedMessageIds: row.dismissedMessageIds.slice(-2),
      },
    });
    return NextResponse.json({ ok: true, signal: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
