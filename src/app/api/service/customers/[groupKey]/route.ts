import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  parseGroupKey,
  resolveCustomerDetail,
  type CustomerSummary,
} from "@/lib/customer-resolver";

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

    const { groupKey: encodedGroupKey } = await params;
    const groupKey = decodeURIComponent(encodedGroupKey);

    // Validate groupKey shape
    const parsed = parseGroupKey(groupKey);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid groupKey format. Must start with 'company:' or 'addr:'" },
        { status: 400 }
      );
    }

    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMER_DETAIL(groupKey);

    // Build a minimal CustomerSummary from the parsed groupKey
    // The detail resolver needs contactIds — these come from the search result
    // that the client already has, passed via query param
    const contactIdsParam = new URL(request.url).searchParams.get("contactIds") || "";
    const contactIds = contactIdsParam.split(",").filter(Boolean);

    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: "contactIds query parameter required" },
        { status: 400 }
      );
    }

    const summary: CustomerSummary = {
      groupKey,
      displayName: "", // will be derived from detail
      address: "",
      contactIds,
      companyId: parsed.companyId,
      dealCount: -1,
      ticketCount: -1,
      jobCount: -1,
    };

    const { data: customer, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => resolveCustomerDetail(summary),
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
