/**
 * Catalog Harvest Adapters
 *
 * Pulls the full product catalog from each of the 5 sources into a uniform
 * HarvestedProduct shape.  This is the read-only data layer for Phase 1 of
 * the catalog rebuild.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HarvestSource =
  | "zoho"
  | "hubspot"
  | "zuper"
  | "internal";

export interface HarvestedProduct {
  source: HarvestSource;
  externalId: string;
  rawName: string;
  rawBrand: string | null;
  rawModel: string | null;
  category: string | null;
  price: number | null;
  description: string | null;
  rawPayload: Record<string, unknown>;
}

export type HarvestWarning =
  | "missing_brand"
  | "missing_model"
  | "ambiguous_category"
  | "name_only";

export interface HarvestResult {
  source: HarvestSource;
  products: HarvestedProduct[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple name-splitting heuristic: first word = brand, rest = model.
 * Used for external sources where structured brand/model is unavailable.
 */
function splitName(name: string): { brand: string | null; model: string | null } {
  const trimmed = name.trim();
  if (!trimmed) return { brand: null, model: null };

  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { brand: trimmed, model: null };

  return {
    brand: trimmed.slice(0, spaceIdx),
    model: trimmed.slice(spaceIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Warning detection
// ---------------------------------------------------------------------------

export function parseHarvestWarnings(p: HarvestedProduct): HarvestWarning[] {
  const warnings: HarvestWarning[] = [];

  const hasBrand = p.rawBrand != null && p.rawBrand.trim().length > 0;
  const hasModel = p.rawModel != null && p.rawModel.trim().length > 0;

  if (!hasBrand && !hasModel) {
    warnings.push("name_only");
  } else {
    if (!hasBrand) warnings.push("missing_brand");
    if (!hasModel) warnings.push("missing_model");
  }

  if (p.category == null || p.category.trim().length === 0) {
    warnings.push("ambiguous_category");
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Adapter: Internal (Prisma EquipmentSku)
// ---------------------------------------------------------------------------

export async function harvestInternal(): Promise<HarvestedProduct[]> {
  const { prisma } = await import("@/lib/db");
  if (!prisma) return [];

  const skus = await prisma.equipmentSku.findMany({
    where: { isActive: true },
  });

  return skus.map((sku) => ({
    source: "internal" as const,
    externalId: sku.id,
    rawName: `${sku.brand} ${sku.model}`,
    rawBrand: sku.brand,
    rawModel: sku.model,
    category: sku.category,
    price: sku.sellPrice,
    description: sku.description,
    rawPayload: JSON.parse(JSON.stringify(sku)) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Adapter: Zoho Inventory
// ---------------------------------------------------------------------------

export async function harvestZoho(): Promise<HarvestedProduct[]> {
  const { ZohoInventoryClient } = await import("@/lib/zoho-inventory");
  const client = new ZohoInventoryClient();
  const items = await client.listItems();

  return items.map((item) => {
    const { brand, model } = splitName(item.name);
    return {
      source: "zoho" as const,
      externalId: item.item_id,
      rawName: item.name,
      rawBrand: brand,
      rawModel: model,
      category: null, // Zoho items don't have a structured category
      price: item.rate ?? null,
      description: item.description ?? null,
      rawPayload: JSON.parse(JSON.stringify(item)) as Record<string, unknown>,
    };
  });
}

// ---------------------------------------------------------------------------
// Adapter: HubSpot Products
// ---------------------------------------------------------------------------

export async function harvestHubSpot(): Promise<HarvestedProduct[]> {
  const { hubspotClient } = await import("@/lib/hubspot");
  if (!hubspotClient) return [];

  const products: HarvestedProduct[] = [];
  let after: string | undefined;

  do {
    const response = await hubspotClient.crm.products.basicApi.getPage(
      100, // limit
      after,
      ["name", "description", "price", "hs_sku"],
    );

    for (const p of response.results) {
      const name = p.properties.name ?? "";
      const { brand, model } = splitName(name);

      products.push({
        source: "hubspot" as const,
        externalId: p.id,
        rawName: name,
        rawBrand: brand,
        rawModel: model,
        category: null,
        price: p.properties.price ? Number(p.properties.price) : null,
        description: p.properties.description ?? null,
        rawPayload: {
          id: p.id,
          properties: p.properties,
        },
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return products;
}

// ---------------------------------------------------------------------------
// Adapter: Zuper Products
// ---------------------------------------------------------------------------

interface ZuperProductsResponse {
  type: string;
  data?: Array<{
    product_uid: string;
    product_name: string;
    description?: string;
    price?: number;
    [key: string]: unknown;
  }>;
}

export async function harvestZuper(): Promise<HarvestedProduct[]> {
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) return [];

  const baseUrl =
    process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

  const products: HarvestedProduct[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${baseUrl}/products?page=${page}&count=100`,
      {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Zuper products API returned ${res.status}`);
    }

    const body = (await res.json()) as ZuperProductsResponse;
    const items = body.data ?? [];

    for (const item of items) {
      const { brand, model } = splitName(item.product_name);
      products.push({
        source: "zuper" as const,
        externalId: item.product_uid,
        rawName: item.product_name,
        rawBrand: brand,
        rawModel: model,
        category: null,
        price: item.price ?? null,
        description: item.description ?? null,
        rawPayload: item as unknown as Record<string, unknown>,
      });
    }

    hasMore = items.length === 100;
    page++;
  }

  return products;
}

// ---------------------------------------------------------------------------
// Orchestrator: harvest all sources
// ---------------------------------------------------------------------------

export async function harvestAll(): Promise<HarvestResult[]> {
  const adapters: Array<{ source: HarvestSource; fn: () => Promise<HarvestedProduct[]> }> = [
    { source: "internal", fn: harvestInternal },
    { source: "zoho", fn: harvestZoho },
    { source: "hubspot", fn: harvestHubSpot },
    { source: "zuper", fn: harvestZuper },
  ];

  const results = await Promise.allSettled(
    adapters.map(async ({ source, fn }) => {
      try {
        const products = await fn();
        return { source, products } satisfies HarvestResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[catalog-harvest] ${source} failed:`, message);
        return { source, products: [], error: message } satisfies HarvestResult;
      }
    }),
  );

  return results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    // Should not happen since inner try/catch covers it, but just in case
    return {
      source: "internal" as HarvestSource,
      products: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}
