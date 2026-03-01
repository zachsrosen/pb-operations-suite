import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import {
  getHubSpotProductUrl,
  getZuperProductUrl,
  getZohoItemUrl,
  getQuickBooksItemUrl,
} from "@/lib/external-links";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER", "MANAGER"]);

type DiagnosticSource = "hubspot" | "zuper" | "zoho" | "quickbooks";
const VALID_SOURCES: DiagnosticSource[] = ["hubspot", "zuper", "zoho", "quickbooks"];

const SOURCE_FIELD_MAP: Record<DiagnosticSource, "hubspotProductId" | "zuperItemId" | "zohoItemId" | "quickbooksItemId"> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
  quickbooks: "quickbooksItemId",
};

function generateUrl(source: DiagnosticSource, externalId: string): string | null {
  switch (source) {
    case "hubspot":
      return getHubSpotProductUrl(externalId);
    case "zuper":
      return getZuperProductUrl(externalId);
    case "zoho":
      return getZohoItemUrl(externalId);
    case "quickbooks":
      return getQuickBooksItemUrl(externalId);
    default:
      return null;
  }
}

function hasEnvTemplate(source: DiagnosticSource): boolean {
  switch (source) {
    case "hubspot":
      return false; // HubSpot uses portal ID, no template override
    case "zuper":
      return Boolean((process.env.ZUPER_PRODUCT_URL_TEMPLATE || "").trim());
    case "zoho":
      return Boolean((process.env.ZOHO_INVENTORY_ITEM_URL_TEMPLATE || "").trim());
    case "quickbooks":
      return Boolean((process.env.QUICKBOOKS_ITEM_URL_TEMPLATE || "").trim());
    default:
      return false;
  }
}

interface DiagnosticRow {
  internalSkuId: string;
  brand: string;
  model: string;
  source: DiagnosticSource;
  externalId: string;
  generatedUrl: string | null;
  hasTemplate: boolean;
  likelyBroken: boolean;
  brokenReason: string | null;
}

export async function GET(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const sourceParam = (searchParams.get("source") || "").trim().toLowerCase();
  const limitParam = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10) || 100, 1), 500);

  const sources: DiagnosticSource[] = sourceParam && VALID_SOURCES.includes(sourceParam as DiagnosticSource)
    ? [sourceParam as DiagnosticSource]
    : [...VALID_SOURCES];

  try {
    // Build where clause: SKUs that have at least one of the requested source IDs
    const orConditions = sources.map((source) => ({
      [SOURCE_FIELD_MAP[source]]: { not: null as string | null, notIn: [""] },
    }));

    const skuRows = await prisma.equipmentSku.findMany({
      where: {
        OR: orConditions,
      },
      select: {
        id: true,
        brand: true,
        model: true,
        hubspotProductId: true,
        zuperItemId: true,
        zohoItemId: true,
        quickbooksItemId: true,
      },
      take: limitParam * 2, // Fetch extra since we expand per-source
      orderBy: { brand: "asc" },
    });

    const diagnostics: DiagnosticRow[] = [];

    for (const sku of skuRows) {
      for (const source of sources) {
        const externalId = (sku[SOURCE_FIELD_MAP[source]] || "").trim();
        if (!externalId) continue;

        const generatedUrl = generateUrl(source, externalId);
        const hasTemplate = hasEnvTemplate(source);

        let likelyBroken = false;
        let brokenReason: string | null = null;

        if (generatedUrl === null) {
          likelyBroken = true;
          brokenReason = source === "quickbooks"
            ? "QUICKBOOKS_COMPANY_ID not set"
            : "URL generation returned null";
        } else if (externalId.length < 3) {
          likelyBroken = true;
          brokenReason = "External ID suspiciously short";
        }

        diagnostics.push({
          internalSkuId: sku.id,
          brand: sku.brand,
          model: sku.model,
          source,
          externalId,
          generatedUrl,
          hasTemplate,
          likelyBroken,
          brokenReason,
        });

        if (diagnostics.length >= limitParam) break;
      }
      if (diagnostics.length >= limitParam) break;
    }

    const summary = {
      total: diagnostics.length,
      likelyBroken: diagnostics.filter((d) => d.likelyBroken).length,
      bySource: Object.fromEntries(
        VALID_SOURCES.map((source) => {
          const sourceRows = diagnostics.filter((d) => d.source === source);
          return [source, {
            total: sourceRows.length,
            likelyBroken: sourceRows.filter((d) => d.likelyBroken).length,
            hasTemplate: hasEnvTemplate(source),
          }];
        })
      ),
    };

    return NextResponse.json({ summary, diagnostics });
  } catch (error) {
    console.error("Link diagnostics failed:", error);
    return NextResponse.json({ error: "Failed to run link diagnostics." }, { status: 500 });
  }
}
