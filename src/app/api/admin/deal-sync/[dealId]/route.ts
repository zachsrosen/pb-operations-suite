import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { syncSingleDeal } from "@/lib/deal-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !["ADMIN", "OWNER"].includes(currentUser.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { dealId } = await params;
  await syncSingleDeal(dealId, "MANUAL");
  return NextResponse.json({ synced: dealId });
}
