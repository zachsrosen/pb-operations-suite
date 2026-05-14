import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { PeDocStatus } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "EXECUTIVE", "ACCOUNTING", "OWNER"];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.some((r: string) => ALLOWED_ROLES.includes(r)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [docs, actionItems, lastSyncRun] = await Promise.all([
    prisma.peDocumentReview.findMany({
      orderBy: [{ dealId: "asc" }, { docName: "asc" }],
    }),
    prisma.peActionItem.findMany({
      where: { resolvedAt: null },
      select: {
        id: true,
        dealId: true,
        peProjectId: true,
        docLabel: true,
        errorCode: true,
        pageNumber: true,
        reviewer: true,
        notes: true,
        actionDate: true,
        resolvedAt: true,
        createdAt: true,
      },
      orderBy: { actionDate: "desc" },
    }),
    prisma.peApiSyncRun.findFirst({
      where: { status: { in: ["completed", "completed_with_errors"] } },
      orderBy: { startedAt: "desc" },
      select: { completedAt: true, startedAt: true, status: true },
    }),
  ]);

  return NextResponse.json({
    docs,
    actionItems,
    lastSync: lastSyncRun?.completedAt?.toISOString() ?? null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.some((r: string) => ALLOWED_ROLES.includes(r)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { dealId, docName, status, notes } = body as {
    dealId: string;
    docName: string;
    status: string;
    notes?: string;
  };

  if (!dealId || !docName || !status) {
    return NextResponse.json({ error: "dealId, docName, and status are required" }, { status: 400 });
  }

  if (!Object.values(PeDocStatus).includes(status as PeDocStatus)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const doc = await prisma.peDocumentReview.upsert({
    where: { dealId_docName: { dealId, docName } },
    create: {
      dealId,
      docName,
      status: status as PeDocStatus,
      notes: notes ?? null,
      reviewedBy: user.email ?? user.name ?? null,
      reviewedAt: new Date(),
    },
    update: {
      status: status as PeDocStatus,
      notes: notes ?? null,
      reviewedBy: user.email ?? user.name ?? null,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({ doc });
}
