import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getDealProperties } from "@/lib/hubspot";
import { discoverPeTemplateIds, findPeDocsForDeal, type PeTemplateStatus } from "@/lib/pandadoc";

export const dynamic = "force-dynamic";

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "21710069";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;

  // Fetch audit run, deal links, and PandaDoc statuses in parallel
  const [latestRun, dealProps, pandadocStatuses] = await Promise.all([
    prisma.peAuditRun.findFirst({
      where: { dealId, status: { in: ["completed", "running"] } },
      orderBy: { startedAt: "desc" },
    }),
    getDealProperties(dealId, ["pe_portal_url", "pe_project_id", "dealname", "all_document_parent_folder_id"]).catch(() => null),
    fetchPandaDocStatuses(dealId),
  ]);

  const pePortalUrl = dealProps?.pe_portal_url
    ? String(dealProps.pe_portal_url).trim() || null
    : null;
  const driveFolderId = dealProps?.all_document_parent_folder_id
    ? String(dealProps.all_document_parent_folder_id).trim() || null
    : null;

  const links = {
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${dealId}`,
    pePortalUrl,
    driveFolderUrl: driveFolderId
      ? `https://drive.google.com/drive/folders/${driveFolderId}`
      : null,
    dealName: dealProps?.dealname ? String(dealProps.dealname).trim() : null,
  };

  if (!latestRun) {
    return NextResponse.json({ auditRun: null, links, pandadocStatuses });
  }

  return NextResponse.json({ auditRun: latestRun, links, pandadocStatuses });
}

async function fetchPandaDocStatuses(dealId: string): Promise<PeTemplateStatus[]> {
  if (process.env.PANDADOC_PE_TEMPLATES_ENABLED !== "true") return [];
  try {
    const templateIds = await discoverPeTemplateIds();
    return await findPeDocsForDeal(dealId, templateIds);
  } catch (err) {
    console.warn(`[pe-status] PandaDoc fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
