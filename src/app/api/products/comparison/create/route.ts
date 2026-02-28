import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, getUserByEmail } from "@/lib/db";
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
import { createOrUpdateZohoItem } from "@/lib/zoho-inventory";
import { createOrUpdateZuperPart } from "@/lib/zuper-catalog";
import { getZuperWebBaseUrl } from "@/lib/external-links";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  internalSkuId: z.string().trim().min(1),
  source: z.enum(["hubspot", "zuper", "zoho", "quickbooks"]),
});

const SOURCE_ENUM: Record<"hubspot" | "zuper" | "zoho" | "quickbooks", CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
  quickbooks: "QUICKBOOKS",
};

const LINK_FIELD_BY_SOURCE: Record<
  "hubspot" | "zuper" | "zoho" | "quickbooks",
  "hubspotProductId" | "zuperItemId" | "zohoItemId" | "quickbooksItemId"
> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
  quickbooks: "quickbooksItemId",
};

function isAllowedRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "OWNER";
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
  const portalId = (process.env.HUBSPOT_PORTAL_ID || "21710069").trim();
  return `https://app.hubspot.com/contacts/${portalId}/record/0-7/${encodeURIComponent(productId)}`;
}

function buildZuperProductUrl(productId: string): string {
  const baseUrl = getZuperWebBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}/app/product/${encodeURIComponent(productId)}`;
}

function buildZohoProductUrl(itemId: string): string {
  const baseUrl = process.env.ZOHO_INVENTORY_WEB_URL || "https://inventory.zoho.com/app#/items";
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(itemId)}`;
}

function buildQuickBooksProductUrl(itemId: string): string | null {
  const companyId = String(process.env.QUICKBOOKS_COMPANY_ID || "").trim();
  if (!companyId) return null;
  const baseUrl = process.env.QUICKBOOKS_WEB_URL || "https://app.qbo.intuit.com";
  return `${baseUrl.replace(/\/$/, "")}/app/items?itemId=${encodeURIComponent(itemId)}&companyId=${encodeURIComponent(companyId)}`;
}

function escapeQuickBooksQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getQuickBooksErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const fault = payload.Fault;
  if (!isRecord(fault)) return fallback;
  const errors = fault.Error;
  if (!Array.isArray(errors) || errors.length === 0) return fallback;
  const first = errors[0];
  if (!isRecord(first)) return fallback;
  const message = String(first.Message || "").trim();
  const detail = String(first.Detail || "").trim();
  return [message, detail].filter(Boolean).join(": ") || fallback;
}

interface QuickBooksItemRecord {
  Id?: string;
  Name?: string;
  Sku?: string;
  Description?: string;
  UnitPrice?: number | string;
  Active?: boolean;
  Type?: string;
}

async function queryQuickBooksItems(
  accessToken: string,
  companyId: string,
  query: string
): Promise<QuickBooksItemRecord[]> {
  const baseUrl = (process.env.QUICKBOOKS_API_BASE_URL || "https://quickbooks.api.intuit.com/v3/company").replace(/\/$/, "");
  const minorVersion = process.env.QUICKBOOKS_MINOR_VERSION || "75";
  const url = `${baseUrl}/${encodeURIComponent(companyId)}/query?query=${encodeURIComponent(query)}&minorversion=${encodeURIComponent(minorVersion)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(getQuickBooksErrorMessage(payload, `QuickBooks query failed (${response.status})`));
  }
  const queryResponse = isRecord(payload) && isRecord(payload.QueryResponse) ? payload.QueryResponse : null;
  const items = queryResponse?.Item;
  return Array.isArray(items) ? (items as QuickBooksItemRecord[]) : [];
}

async function createOrFindQuickBooksItem(input: {
  brand: string;
  model: string;
  sku: string | null;
  description: string | null;
  sellPrice: number | null;
}): Promise<{ quickbooksItemId: string; created: boolean; name: string | null; sku: string | null; description: string | null; price: number | null; status: string | null; url: string | null }> {
  const accessToken = String(process.env.QUICKBOOKS_ACCESS_TOKEN || "").trim();
  const companyId = String(process.env.QUICKBOOKS_COMPANY_ID || "").trim();
  if (!accessToken || !companyId) {
    throw new Error("QuickBooks create requires QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_COMPANY_ID");
  }

  const name = `${String(input.brand || "").trim()} ${String(input.model || "").trim()}`.trim();
  if (!name) throw new Error("QuickBooks item requires brand and model");
  const sku = String(input.sku || "").trim() || null;
  const description = String(input.description || "").trim() || null;
  const price = parsePrice(input.sellPrice);

  if (sku) {
    const matches = await queryQuickBooksItems(
      accessToken,
      companyId,
      `select * from Item where Sku = '${escapeQuickBooksQuery(sku)}' startposition 1 maxresults 10`
    );
    const match = matches.find((item) => String(item.Id || "").trim());
    if (match?.Id) {
      const id = String(match.Id).trim();
      return {
        quickbooksItemId: id,
        created: false,
        name: String(match.Name || "").trim() || name,
        sku: String(match.Sku || "").trim() || sku,
        description: String(match.Description || "").trim() || description,
        price: parsePrice(match.UnitPrice) ?? price,
        status: match.Active === false ? "inactive" : "active",
        url: buildQuickBooksProductUrl(id),
      };
    }
  }

  const byName = await queryQuickBooksItems(
    accessToken,
    companyId,
    `select * from Item where Name = '${escapeQuickBooksQuery(name)}' startposition 1 maxresults 10`
  );
  const nameMatch = byName.find((item) => String(item.Id || "").trim());
  if (nameMatch?.Id) {
    const id = String(nameMatch.Id).trim();
    return {
      quickbooksItemId: id,
      created: false,
      name: String(nameMatch.Name || "").trim() || name,
      sku: String(nameMatch.Sku || "").trim() || sku,
      description: String(nameMatch.Description || "").trim() || description,
      price: parsePrice(nameMatch.UnitPrice) ?? price,
      status: nameMatch.Active === false ? "inactive" : "active",
      url: buildQuickBooksProductUrl(id),
    };
  }

  const baseUrl = (process.env.QUICKBOOKS_API_BASE_URL || "https://quickbooks.api.intuit.com/v3/company").replace(/\/$/, "");
  const minorVersion = process.env.QUICKBOOKS_MINOR_VERSION || "75";
  const postUrl = `${baseUrl}/${encodeURIComponent(companyId)}/item?minorversion=${encodeURIComponent(minorVersion)}`;

  const payload: Record<string, unknown> = {
    Name: name,
    Type: "Service",
    Active: true,
  };
  if (sku) payload.Sku = sku;
  if (description) payload.Description = description;
  if (typeof price === "number") payload.UnitPrice = price;
  const incomeAccountId = String(process.env.QUICKBOOKS_INCOME_ACCOUNT_ID || "").trim();
  if (incomeAccountId) {
    payload.IncomeAccountRef = { value: incomeAccountId };
  }

  const createResponse = await fetch(postUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const createPayload = (await createResponse.json().catch(() => null)) as unknown;
  if (!createResponse.ok) {
    throw new Error(getQuickBooksErrorMessage(createPayload, `QuickBooks create failed (${createResponse.status})`));
  }

  const createdItem = isRecord(createPayload) && isRecord(createPayload.Item) ? createPayload.Item : null;
  const createdId = createdItem ? String(createdItem.Id || "").trim() : "";
  if (!createdId) {
    throw new Error("QuickBooks create succeeded but did not return an item ID");
  }

  return {
    quickbooksItemId: createdId,
    created: true,
    name: createdItem ? String(createdItem.Name || "").trim() || name : name,
    sku: createdItem ? String(createdItem.Sku || "").trim() || sku : sku,
    description: createdItem ? String(createdItem.Description || "").trim() || description : description,
    price: createdItem ? parsePrice(createdItem.UnitPrice) ?? price : price,
    status: createdItem && createdItem.Active === false ? "inactive" : "active",
    url: buildQuickBooksProductUrl(createdId),
  };
}

function specRecordToMetadata(record: unknown): Record<string, unknown> {
  if (!isRecord(record)) return {};
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "skuId") continue;
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

  const skuRecord = await prisma.equipmentSku.findUnique({
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
    return NextResponse.json({ error: "Internal SKU not found" }, { status: 404 });
  }

  const brand = String(skuRecord.brand || "").trim();
  const model = String(skuRecord.model || "").trim();
  if (!brand || !model) {
    return NextResponse.json({ error: "Internal SKU must have brand and model" }, { status: 400 });
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
      });
      externalId = result.zohoItemId;
      created = result.created;
      responseUrl = buildZohoProductUrl(externalId);
    } else if (source === "quickbooks") {
      const result = await createOrFindQuickBooksItem({
        brand,
        model,
        sku: internalSkuValue,
        description,
        sellPrice: parsePrice(skuRecord.sellPrice),
      });
      externalId = result.quickbooksItemId;
      created = result.created;
      responseName = result.name;
      responseSku = result.sku;
      responseDescription = result.description;
      responsePrice = result.price;
      responseStatus = result.status;
      responseUrl = result.url;
    }

    if (!externalId) {
      return NextResponse.json({ error: "Source creation did not return an external ID" }, { status: 502 });
    }

    const linkField = LINK_FIELD_BY_SOURCE[source];
    await prisma.equipmentSku.update({
      where: { id: internalSkuId },
      data: { [linkField]: externalId },
    });

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
