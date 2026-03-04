import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { CatalogProductSource } from "@/generated/prisma/enums";
import {
  getHubSpotProductUrl,
  getOpenSolarProductUrl,
  getQuickBooksItemUrl,
  getZohoItemUrl,
  getZuperProductUrl,
} from "@/lib/external-links";

const ALLOWED_ROLES = new Set<UserRole>([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
  "PERMITTING",
  "SALES",
]);

const SOURCE_ENUM: Record<string, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
  quickbooks: "QUICKBOOKS",
  opensolar: "OPENSOLAR",
};

type SourceApiValue = "hubspot" | "zuper" | "zoho" | "quickbooks" | "opensolar";

function sourceToApiValue(source: CatalogProductSource): SourceApiValue {
  const map: Record<CatalogProductSource, SourceApiValue> = {
    HUBSPOT: "hubspot",
    ZUPER: "zuper",
    ZOHO: "zoho",
    QUICKBOOKS: "quickbooks",
    OPENSOLAR: "opensolar",
  };
  return map[source];
}

function fallbackUrlForSource(source: SourceApiValue, externalId: string): string | null {
  const id = String(externalId || "").trim();
  if (!id) return null;
  if (source === "hubspot") return getHubSpotProductUrl(id);
  if (source === "zuper") return getZuperProductUrl(id);
  if (source === "zoho") return getZohoItemUrl(id);
  if (source === "opensolar") return getOpenSolarProductUrl(id);
  return getQuickBooksItemUrl(id);
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

  const sourceParam = String(request.nextUrl.searchParams.get("source") || "")
    .trim()
    .toLowerCase();
  const search = String(request.nextUrl.searchParams.get("search") || "").trim();
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 5000) : 200;

  // QuickBooks deactivated — re-add "QUICKBOOKS" to reactivate
  let sources: CatalogProductSource[] = ["HUBSPOT", "ZUPER", "ZOHO", "OPENSOLAR"];
  if (sourceParam) {
    const parsed = sourceParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => SOURCE_ENUM[s])
      .filter(Boolean);
    if (parsed.length === 0) {
      return NextResponse.json({ error: "Invalid source. Use hubspot,zuper,zoho,quickbooks,opensolar" }, { status: 400 });
    }
    sources = [...new Set(parsed)];
  }

  const where = {
    source: { in: sources },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { sku: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
            { externalId: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const rows = await prisma.catalogProduct.findMany({
    where,
    orderBy: [{ source: "asc" }, { updatedAt: "desc" }],
    take: limit,
  });

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const source = sourceToApiValue(row.source);
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    products: rows.map((row) => ({
      // Some cached rows (especially seeded imports) do not have a URL persisted.
      // Provide deterministic source fallback URLs for better operator navigation.
      source: sourceToApiValue(row.source),
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      sku: row.sku,
      description: row.description,
      price: row.price,
      status: row.status,
      url: row.url || fallbackUrlForSource(sourceToApiValue(row.source), row.externalId),
      normalizedName: row.normalizedName,
      normalizedSku: row.normalizedSku,
      lastSyncedAt: row.lastSyncedAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    })),
    summary: {
      count: rows.length,
      bySource: {
        hubspot: counts.hubspot || 0,
        zuper: counts.zuper || 0,
        zoho: counts.zoho || 0,
        quickbooks: counts.quickbooks || 0,
        opensolar: counts.opensolar || 0,
      },
    },
  });
}
