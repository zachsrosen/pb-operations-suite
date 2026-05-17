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

  // Fetch audit run and deal links first, then PandaDoc (needs customer name from deal)
  const [latestRun, dealProps] = await Promise.all([
    prisma.peAuditRun.findFirst({
      where: { dealId, status: { in: ["completed", "running"] } },
      orderBy: { startedAt: "desc" },
    }),
    getDealProperties(dealId, ["pe_portal_url", "pe_project_id", "dealname", "all_document_parent_folder_id"]).catch(() => null),
  ]);

  // Extract customer last name from deal name for PandaDoc name-based search.
  // Deal name format: "PROJ-9542 | Brownell, Matt | 16578 W 55th Dr, ..."
  const customerName = extractCustomerLastName(dealProps?.dealname ? String(dealProps.dealname) : null);
  const pandadocStatuses = await fetchPandaDocStatuses(dealId, customerName);

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

function extractCustomerLastName(dealName: string | null): string | undefined {
  if (!dealName) return undefined;
  // "PROJ-9542 | Brownell, Matt | 16578 W 55th Dr, ..." → "Brownell"
  const parts = dealName.split("|");
  if (parts.length >= 2) {
    const namePart = parts[1].trim(); // "Brownell, Matt"
    const lastName = namePart.split(",")[0].trim();
    if (lastName && lastName.length >= 2) return lastName;
  }
  return undefined;
}

async function fetchPandaDocStatuses(dealId: string, customerName?: string): Promise<PeTemplateStatus[]> {
  if (process.env.PANDADOC_PE_TEMPLATES_ENABLED !== "true") return [];
  try {
    const templateIds = await discoverPeTemplateIds();
    return await findPeDocsForDeal(dealId, templateIds, customerName);
  } catch (err) {
    console.warn(`[pe-status] PandaDoc fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
