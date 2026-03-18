import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchContacts } from "@/lib/customer-resolver";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get("q") || "";
    const query = rawQuery.trim().toLowerCase();

    if (query.length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const forceRefresh = searchParams.get("refresh") === "true";

    // Hash the normalized query for cache key
    const queryHash = crypto.createHash("md5").update(query).digest("hex").slice(0, 12);
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMERS_SEARCH(queryHash);

    const { data, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => searchContacts(query),
      forceRefresh
    );

    return NextResponse.json({
      results: data.results,
      query,
      truncated: data.truncated,
      lastUpdated,
    });
  } catch (error) {
    console.error("[CustomerSearch] Error:", error);
    return NextResponse.json(
      { error: "Failed to search customers" },
      { status: 500 }
    );
  }
}
