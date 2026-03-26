import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { CatalogProductSource } from "@/generated/prisma/enums";
import {
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getSpecTableName,
  getZuperCategoryValue,
  generateZuperSpecification,
} from "@/lib/catalog-fields";
import { createOrUpdateHubSpotProduct } from "@/lib/hubspot";
import { createOrUpdateZohoItem, zohoInventory } from "@/lib/zoho-inventory";
import { createOrUpdateZuperPart, updateZuperPart, buildZuperProductCustomFields } from "@/lib/zuper-catalog";
import {
  getHubSpotProductUrl,
  getZohoItemUrl,
  getZuperProductUrl,
} from "@/lib/external-links";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  internalSkuId: z.string().trim().min(1),
  source: z.enum(["hubspot", "zuper", "zoho"]),
});

const SOURCE_ENUM: Record<"hubspot" | "zuper" | "zoho", CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
};

const LINK_FIELD_BY_SOURCE: Record<
  "hubspot" | "zuper" | "zoho",
  "hubspotProductId" | "zuperItemId" | "zohoItemId"
> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
};

function isAllowedRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "EXECUTIVE";
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function buildHubSpotProductUrl(productId: string): string {
  return getHubSpotProductUrl(productId);
}

function buildZuperProductUrl(productId: string): string {
  return getZuperProductUrl(productId);
}

function buildZohoProductUrl(itemId: string): string {
  return getZohoItemUrl(itemId);
}

function specRecordToMetadata(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "internalProductId") continue;
    if (value === null || value === undefined || value === "") continue;
    metadata[key] = value;
  }
  return metadata;
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!isAllowedRole(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { internalSkuId, source } = parsed.data;

  const skuRecord = await prisma.internalProduct.findUnique({
    where: { id: internalSkuId },
    include: {
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
  });
  if (!skuRecord) {
    return NextResponse.json({ error: "Internal product not found" }, { status: 404 });
  }

  const brand = String(skuRecord.brand || "").trim();
  const model = String(skuRecord.model || "").trim();
  if (!brand || !model) {
    return NextResponse.json({ error: "Internal product must have brand and model" }, { status: 400 });
  }

  const internalSkuValue = String(skuRecord.sku || skuRecord.vendorPartNumber || "").trim() || null;
  const description = String(skuRecord.description || "").trim() || null;
  const name = `${brand} ${model}`.trim();
  const specTable = getSpecTableName(skuRecord.category);
  const metadata = specTable ? specRecordToMetadata((skuRecord as Record<string, unknown>)[specTable]) : {};

  try {
    let externalId = "";
    let created = false;
    let responseName: string | null = name;
    let responseSku: string | null = internalSkuValue;
    let responseDescription: string | null = description;
    let responsePrice: number | null = parsePrice(skuRecord.sellPrice);
    let responseStatus: string | null = "active";
    let responseUrl: string | null = null;

    if (source === "hubspot") {
      const result = await createOrUpdateHubSpotProduct({
        brand,
        model,
        description,
        sku: internalSkuValue,
        productCategory: getHubspotCategoryValue(skuRecord.category) || null,
        sellPrice: parsePrice(skuRecord.sellPrice),
        unitCost: parsePrice(skuRecord.unitCost),
        hardToProcure: typeof skuRecord.hardToProcure === "boolean" ? skuRecord.hardToProcure : null,
        length: parsePrice(skuRecord.length),
        width: parsePrice(skuRecord.width),
        internalProductId: internalSkuId,
        additionalProperties: getHubspotPropertiesFromMetadata(skuRecord.category, metadata),
      });
      externalId = result.hubspotProductId;
      created = result.created;
      responseUrl = buildHubSpotProductUrl(externalId);
    } else if (source === "zuper") {
      const result = await createOrUpdateZuperPart({
        brand,
        model,
        description,
        sku: internalSkuValue,
        unitLabel: String(skuRecord.unitLabel || "").trim() || null,
        vendorName: String(skuRecord.vendorName || "").trim() || null,
        vendorPartNumber: String(skuRecord.vendorPartNumber || "").trim() || null,
        sellPrice: parsePrice(skuRecord.sellPrice),
        unitCost: parsePrice(skuRecord.unitCost),
        category: getZuperCategoryValue(skuRecord.category) || null,
        specification: generateZuperSpecification(skuRecord.category, metadata),
      });
      externalId = result.zuperItemId;
      created = result.created;
      responseUrl = buildZuperProductUrl(externalId);
    } else if (source === "zoho") {
      const result = await createOrUpdateZohoItem({
        brand,
        model,
        description,
        sku: internalSkuValue,
        unitLabel: String(skuRecord.unitLabel || "").trim() || null,
        vendorName: String(skuRecord.vendorName || "").trim() || null,
        sellPrice: parsePrice(skuRecord.sellPrice),
        unitCost: parsePrice(skuRecord.unitCost),
        internalProductId: internalSkuId,
      });
      externalId = result.zohoItemId;
      created = result.created;
      responseUrl = buildZohoProductUrl(externalId);
    }

    if (!externalId) {
      return NextResponse.json({ error: "Source creation did not return an external ID" }, { status: 502 });
    }

    const linkField = LINK_FIELD_BY_SOURCE[source];
    await prisma.internalProduct.update({
      where: { id: internalSkuId },
      data: { [linkField]: externalId },
    });

    // Cross-link IDs to other systems (non-fatal)
    try {
      const freshSku = await prisma.internalProduct.findUnique({
        where: { id: internalSkuId },
        select: { hubspotProductId: true, zuperItemId: true, zohoItemId: true },
      });
      if (freshSku) {
        // Write cross-link IDs to Zoho custom fields
        if (freshSku.zohoItemId) {
          const cf: Array<{ api_name: string; value: string }> = [];
          if (freshSku.zuperItemId) cf.push({ api_name: "cf_zuper_product_id", value: freshSku.zuperItemId });
          if (freshSku.hubspotProductId) cf.push({ api_name: "cf_hubspot_product_id", value: freshSku.hubspotProductId });
          cf.push({ api_name: "cf_internal_product_id", value: internalSkuId });
          if (cf.length > 0) await zohoInventory.updateItem(freshSku.zohoItemId, { custom_fields: cf });
        }
        // Write cross-link IDs to Zuper custom fields
        if (freshSku.zuperItemId) {
          const zuperCf = buildZuperProductCustomFields({
            hubspotProductId: freshSku.hubspotProductId,
            zohoItemId: freshSku.zohoItemId,
            internalProductId: internalSkuId,
          });
          if (zuperCf) await updateZuperPart(freshSku.zuperItemId, { custom_fields: zuperCf });
        }
        // Write cross-link IDs to HubSpot product properties
        if (freshSku.hubspotProductId) {
          const hsProps: Record<string, string> = {};
          if (freshSku.zuperItemId) hsProps.zuper_item_id = freshSku.zuperItemId;
          if (freshSku.zohoItemId) hsProps.zoho_item_id = freshSku.zohoItemId;
          hsProps.internal_product_id = internalSkuId;
          const token = process.env.HUBSPOT_ACCESS_TOKEN;
          if (token) {
            await fetch(`https://api.hubapi.com/crm/v3/objects/products/${freshSku.hubspotProductId}`, {
              method: "PATCH",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ properties: hsProps }),
            });
          }
        }
      }
    } catch {
      // Cross-linking is best-effort; don't fail the creation
    }

    await prisma.catalogProduct.upsert({
      where: {
        source_externalId: {
          source: SOURCE_ENUM[source],
          externalId,
        },
      },
      update: {
        name: responseName,
        sku: responseSku,
        normalizedName: normalizeText(responseName),
        normalizedSku: normalizeSku(responseSku),
        description: responseDescription,
        price: responsePrice,
        status: responseStatus,
        url: responseUrl,
        lastSyncedAt: new Date(),
      },
      create: {
        source: SOURCE_ENUM[source],
        externalId,
        name: responseName,
        sku: responseSku,
        normalizedName: normalizeText(responseName),
        normalizedSku: normalizeSku(responseSku),
        description: responseDescription,
        price: responsePrice,
        status: responseStatus,
        url: responseUrl,
        lastSyncedAt: new Date(),
      },
    });

    await logActivity({
      type: "FEATURE_USED",
      description: `${created ? "Created" : "Linked existing"} ${source} product from comparison`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "product_comparison",
      entityId: internalSkuId,
      entityName: name,
      metadata: {
        feature: "product_comparison",
        action: "create_source_link",
        source,
        created,
        internalSkuId,
        externalId,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: request.nextUrl.pathname,
      requestMethod: request.method,
      responseStatus: 200,
    });

    return NextResponse.json({
      source,
      created,
      externalId,
      linkField,
      product: {
        id: externalId,
        name: responseName,
        sku: responseSku,
        price: responsePrice,
        status: responseStatus,
        description: responseDescription,
        url: responseUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create/link source product";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
