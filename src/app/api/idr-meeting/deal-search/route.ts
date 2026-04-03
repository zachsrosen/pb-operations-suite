import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.length < 2) {
    return NextResponse.json({ deals: [] });
  }

  const response = await searchWithRetry({
    query: q,
    filterGroups: [
      {
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
        ],
      },
    ],
    properties: ["dealname", "pb_location", "project_type", "design_status"],
    limit: 20,
  });

  const deals = (response?.results ?? []).map((deal) => ({
    dealId: deal.id,
    dealName: deal.properties.dealname,
    region: deal.properties.pb_location,
    projectType: deal.properties.project_type,
    designStatus: deal.properties.design_status,
  }));

  return NextResponse.json({ deals });
}
