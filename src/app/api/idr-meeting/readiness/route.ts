import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { runReadinessReport } from "@/lib/checks/site-survey-readiness";
import { hubspotClient } from "@/lib/hubspot";

const READINESS_PROPERTIES = [
  "dealname", "project_type", "site_survey_documents",
  "all_document_parent_folder_id", "site_survey_status",
  "is_site_survey_completed_", "site_surveyor", "site_survey_date",
  "module_brand", "module_count", "inverter_brand",
  "battery_brand", "battery_count", "calculated_system_size__kwdc_",
];

/**
 * GET /api/idr-meeting/readiness?dealId=xxx
 * Survey readiness check by dealId — works for both preview and session items.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  const deal = await hubspotClient.crm.deals.basicApi.getById(
    dealId,
    READINESS_PROPERTIES,
  );

  const report = await runReadinessReport(
    dealId,
    deal.properties as Record<string, string | null>,
  );

  return NextResponse.json(report);
}
