import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { MergedRequestRow } from "@/lib/product-requests/types";

export async function GET(req: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = req.nextUrl.searchParams.get("status") || "";
  const pushStatus =
    statusFilter === "PENDING" || statusFilter === "APPROVED" || statusFilter === "REJECTED"
      ? statusFilter
      : null;
  const adderStatus =
    statusFilter === "PENDING" || statusFilter === "ADDED" || statusFilter === "DECLINED"
      ? statusFilter
      : null;

  const [eq, ad] = await Promise.all([
    prisma.pendingCatalogPush.findMany({
      where: {
        source: "SALES_REQUEST",
        ...(pushStatus ? { status: pushStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.adderRequest.findMany({
      where: adderStatus ? { status: adderStatus } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const rows: MergedRequestRow[] = [
    ...eq.map((r) => ({
      id: `eq_${r.id}`,
      type: "EQUIPMENT" as const,
      status: r.status,
      title: `${r.brand} ${r.model}`,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
      dealId: r.dealId,
      salesRequestNote: r.salesRequestNote,
    })),
    ...ad.map((r) => ({
      id: `ad_${r.id}`,
      type: "ADDER" as const,
      status: r.status,
      title: r.name,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
      dealId: r.dealId,
      salesRequestNote: r.salesRequestNote,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({ rows });
}
