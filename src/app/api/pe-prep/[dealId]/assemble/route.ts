import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { resolvePEDeal, assemblePackage, type TurnoverAuditResult } from "@/lib/pe-turnover";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const body = await req.json().catch(() => ({}));
  const { auditRunId } = body;

  if (!auditRunId) {
    return NextResponse.json({ error: "auditRunId is required" }, { status: 400 });
  }

  const auditRun = await prisma.peAuditRun.findUnique({ where: { id: auditRunId } });
  if (!auditRun || auditRun.dealId !== dealId || auditRun.status !== "completed") {
    return NextResponse.json({ error: "Invalid or incomplete audit run" }, { status: 400 });
  }

  const deal = await resolvePEDeal(dealId);
  if (!deal.rootFolderId) {
    return NextResponse.json({ error: "No root Drive folder" }, { status: 400 });
  }

  const auditResult: TurnoverAuditResult = {
    dealId,
    dealName: auditRun.dealName,
    address: deal.address,
    systemType: deal.systemType,
    milestone: auditRun.milestone as "m1" | "m2",
    peStatus: auditRun.milestone === "m1" ? deal.peM1Status : deal.peM2Status,
    categories: (auditRun.results as unknown as TurnoverAuditResult["categories"]) ?? [],
    summary: (auditRun.summary as unknown as TurnoverAuditResult["summary"]) ?? {
      totalItems: 0, found: 0, missing: 0, needsReview: 0, notApplicable: 0, errors: 0, ready: false,
    },
  };

  try {
    const result = await assemblePackage(auditResult, deal.rootFolderId);

    await prisma.peAuditRun.update({
      where: { id: auditRunId },
      data: {
        packageFolderId: result.folderId,
        packageFolderUrl: result.folderUrl,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assembly failed" },
      { status: 500 },
    );
  }
}
