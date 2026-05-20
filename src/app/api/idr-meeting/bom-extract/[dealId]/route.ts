import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { extractBomForDeal } from "@/lib/idr-bom-extract";
import { prisma } from "@/lib/db";

export const maxDuration = 120; // extraction can take 60s+

/**
 * POST /api/idr-meeting/bom-extract/[dealId]
 *
 * On-demand BOM extraction for escalation items or re-extractions.
 * Body: { dealName: string, designFolderUrl: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const body = await req.json().catch(() => ({})) as {
    dealName?: string;
    designFolderUrl?: string;
  };

  const result = await extractBomForDeal({
    dealId,
    dealName: body.dealName || `Deal ${dealId}`,
    designFolderUrl: body.designFolderUrl || null,
    actor: {
      email: auth.email,
      name: auth.name ?? auth.email,
    },
  });

  if (result.status === "failed") {
    return NextResponse.json({ ...result }, { status: 422 });
  }

  return NextResponse.json(result);
}

/**
 * GET /api/idr-meeting/bom-extract/[dealId]
 *
 * Returns the latest BOM snapshot for the deal, if any.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;

  if (!prisma) {
    return NextResponse.json({ snapshot: null }, { status: 503 });
  }

  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      version: true,
      bomData: true,
      sourceFile: true,
      savedBy: true,
      createdAt: true,
    },
  });

  if (!snapshot) {
    return NextResponse.json({ snapshot: null });
  }

  return NextResponse.json({ snapshot });
}
