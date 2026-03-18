import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { resolveContactDetail } from "@/lib/customer-resolver";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupKey: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { groupKey: encodedContactId } = await params;
    const contactId = decodeURIComponent(encodedContactId);

    if (!contactId) {
      return NextResponse.json(
        { error: "Contact ID is required" },
        { status: 400 }
      );
    }

    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMER_DETAIL(contactId);

    const { data: customer, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => resolveContactDetail(contactId),
      forceRefresh
    );

    return NextResponse.json({
      customer,
      lastUpdated,
    });
  } catch (error) {
    console.error("[CustomerDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to load customer detail" },
      { status: 500 }
    );
  }
}
