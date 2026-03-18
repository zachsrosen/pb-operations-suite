import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  parseGroupKey,
  resolveContactIdsFromGroupKey,
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

    const { data: customer, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      async () => {
        // Self-resolve contactIds from the groupKey — no client input
        const contactIds = await resolveContactIdsFromGroupKey(parsed);

        if (contactIds.length === 0) {
          // Return a minimal empty detail rather than failing
          return {
            groupKey,
            displayName: "",
            address: parsed.normalizedAddress.replace("|", ", "),
            contactIds: [],
            companyId: parsed.companyId,
            dealCount: 0,
            ticketCount: 0,
            jobCount: 0,
            contacts: [],
            deals: [],
            tickets: [],
            jobs: [],
          };
        }

        const summary: CustomerSummary = {
          groupKey,
          displayName: "",
          address: "",
          contactIds,
          companyId: parsed.companyId,
          dealCount: null,
          ticketCount: null,
          jobCount: null,
        };

        return resolveCustomerDetail(summary);
      },
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
