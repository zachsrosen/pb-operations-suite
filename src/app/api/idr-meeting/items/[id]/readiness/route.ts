import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const item = await prisma.idrMeetingItem.findUnique({
    where: { id },
    select: { dealId: true },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Fetch deal properties needed for readiness check
  const deal = await hubspotClient.crm.deals.basicApi.getById(
    item.dealId,
    READINESS_PROPERTIES,
  );

  const report = await runReadinessReport(
    item.dealId,
    deal.properties as Record<string, string | null>,
  );

  return NextResponse.json(report);
}
