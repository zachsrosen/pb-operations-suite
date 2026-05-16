import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const permits = await prisma.shovelsPermitRecord.findMany({
    where: { propertyId: id },
    orderBy: { fileDate: "desc" },
  });

  // Join contractor names
  const contractorIds = [...new Set(permits.map((p) => p.contractorId).filter(Boolean) as string[])];
  const contractors = contractorIds.length > 0
    ? await prisma.shovelsContractor.findMany({
        where: { shovelsId: { in: contractorIds } },
        select: { shovelsId: true, name: true, classification: true },
      })
    : [];
  const contractorMap = new Map(contractors.map((c) => [c.shovelsId, c]));

  const enriched = permits.map((p) => ({
    ...p,
    contractorName: p.contractorId ? contractorMap.get(p.contractorId)?.name ?? null : null,
    contractorClassification: p.contractorId ? contractorMap.get(p.contractorId)?.classification ?? null : null,
  }));

  return NextResponse.json({ permits: enriched });
}
