import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { searchWithRetry } from "@/lib/hubspot";

/**
 * GET /api/shit-show-meeting/deal-search?q=...
 *
 * Mirrors /api/idr-meeting/deal-search but lives under the shit-show namespace
 * so the role allowlist coverage is single-prefix.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.length < 2) {
    return NextResponse.json({ deals: [] });
  }

  // No pipeline filter — shit-show review is broader than IDR (any deal can
  // be a shit show, not just project-pipeline deals).
  const response = await searchWithRetry({
    query: q,
    filterGroups: [],
    properties: ["dealname", "pb_location", "project_type", "design_status", "amount", "dealstage"],
    limit: 20,
  });

  const deals = (response?.results ?? []).map((deal) => ({
    dealId: deal.id,
    dealName: deal.properties.dealname,
    region: deal.properties.pb_location,
    projectType: deal.properties.project_type,
    designStatus: deal.properties.design_status,
    dealAmount: deal.properties.amount,
    stage: deal.properties.dealstage,
  }));

  return NextResponse.json({ deals });
}
