import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncSingleDeal } from "@/lib/deal-sync";

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;

  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Invalid deal ID" }, { status: 400 });
  }

  try {
    const result = await syncSingleDeal(dealId, "MANUAL");
    return NextResponse.json({ success: true, diff: result.diff ?? {} });
  } catch (err) {
    console.error(`[deal-sync] Manual sync failed for ${dealId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
