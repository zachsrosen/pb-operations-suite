import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { filterMetadataToSpecFields, getCategoryFields } from "@/lib/catalog-fields";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;
type ParsedNumber =
  | { provided: false }
  | { provided: true; value: number | null }
  | { provided: true; error: string };

type ParsedBoolean =
  | { provided: false }
  | { provided: true; value: boolean }
  | { provided: true; error: string };

type ParsedMetadata =
  | { provided: false }
  | { provided: true; value: Record<string, unknown> | null }
  | { provided: true; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseNullableString(body: Record<string, unknown>, key: string): { provided: boolean; value: string | null } {
  if (!(key in body)) return { provided: false, value: null };
  const raw = body[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  const trimmed = String(raw).trim();
  return { provided: true, value: trimmed || null };
}

function parseOptionalNumber(body: Record<string, unknown>, key: string): ParsedNumber {
  if (!(key in body)) return { provided: false };
  const raw = body[key];
  if (raw === null || raw === undefined || raw === "") return { provided: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { provided: true, value: null };

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { provided: true, error: `${key} must be a valid number` };
  }

  return { provided: true, value: parsed };
}

function parseOptionalBoolean(body: Record<string, unknown>, key: string): ParsedBoolean {
  if (!(key in body)) return { provided: false };
  const raw = body[key];
  if (typeof raw === "boolean") return { provided: true, value: raw };
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return { provided: true, value: true };
    if (normalized === "false") return { provided: true, value: false };
  }
  return { provided: true, error: `${key} must be a boolean` };
}

function parseOptionalMetadata(
  body: Record<string, unknown>,
  category: string,
  key = "metadata"
): ParsedMetadata {
  if (!(key in body)) return { provided: false };
  const raw = body[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (!isRecord(raw)) {
    return { provided: true, error: `${key} must be an object` };
  }

  const filtered = filterMetadataToSpecFields(category, raw);
  const normalized: Record<string, unknown> = {};

  for (const field of getCategoryFields(category)) {
    if (!(field.key in filtered)) continue;
    const value = filtered[field.key];

    if (field.type === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return { provided: true, error: `${field.key} must be a valid number` };
      }
      normalized[field.key] = parsed;
      continue;
    }

    if (field.type === "toggle") {
      if (typeof value === "boolean") {
        normalized[field.key] = value;
        continue;
      }
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true") {
          normalized[field.key] = true;
          continue;
        }
        if (lower === "false") {
          normalized[field.key] = false;
          continue;
        }
      }
      return { provided: true, error: `${field.key} must be a boolean` };
    }

    const text = String(value ?? "").trim();
    if (text) normalized[field.key] = text;
  }

  return { provided: true, value: Object.keys(normalized).length > 0 ? normalized : null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "PENDING") {
    return NextResponse.json({ error: `Cannot edit ${existing.status.toLowerCase()} request` }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if ("brand" in body) {
    const brand = String(body.brand || "").trim();
    if (!brand) return NextResponse.json({ error: "brand is required" }, { status: 400 });
    updateData.brand = brand;
  }
  if ("model" in body) {
    const model = String(body.model || "").trim();
    if (!model) return NextResponse.json({ error: "model is required" }, { status: 400 });
    updateData.model = model;
  }
  if ("description" in body) {
    const description = String(body.description || "").trim();
    if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });
    updateData.description = description;
  }
  if ("category" in body) {
    const category = String(body.category || "").trim();
    if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });
    updateData.category = category;
  }

  const unitSpecParsed = parseNullableString(body, "unitSpec");
  const unitLabelParsed = parseNullableString(body, "unitLabel");
  const skuParsed = parseNullableString(body, "sku");
  const vendorNameParsed = parseNullableString(body, "vendorName");
  const vendorPartParsed = parseNullableString(body, "vendorPartNumber");

  if (unitSpecParsed.provided) updateData.unitSpec = unitSpecParsed.value;
  if (unitLabelParsed.provided) updateData.unitLabel = unitLabelParsed.value;
  if (skuParsed.provided) updateData.sku = skuParsed.value;
  if (vendorNameParsed.provided) updateData.vendorName = vendorNameParsed.value;
  if (vendorPartParsed.provided) updateData.vendorPartNumber = vendorPartParsed.value;

  const unitCostParsed = parseOptionalNumber(body, "unitCost");
  const sellPriceParsed = parseOptionalNumber(body, "sellPrice");
  const lengthParsed = parseOptionalNumber(body, "length");
  const widthParsed = parseOptionalNumber(body, "width");
  const weightParsed = parseOptionalNumber(body, "weight");

  if ("error" in unitCostParsed) return NextResponse.json({ error: unitCostParsed.error }, { status: 400 });
  if ("error" in sellPriceParsed) return NextResponse.json({ error: sellPriceParsed.error }, { status: 400 });
  if ("error" in lengthParsed) return NextResponse.json({ error: lengthParsed.error }, { status: 400 });
  if ("error" in widthParsed) return NextResponse.json({ error: widthParsed.error }, { status: 400 });
  if ("error" in weightParsed) return NextResponse.json({ error: weightParsed.error }, { status: 400 });

  if (unitCostParsed.provided) updateData.unitCost = unitCostParsed.value;
  if (sellPriceParsed.provided) updateData.sellPrice = sellPriceParsed.value;
  if (lengthParsed.provided) updateData.length = lengthParsed.value;
  if (widthParsed.provided) updateData.width = widthParsed.value;
  if (weightParsed.provided) updateData.weight = weightParsed.value;

  const hardToProcureParsed = parseOptionalBoolean(body, "hardToProcure");
  if ("error" in hardToProcureParsed) return NextResponse.json({ error: hardToProcureParsed.error }, { status: 400 });
  if (hardToProcureParsed.provided) updateData.hardToProcure = hardToProcureParsed.value;

  if ("systems" in body) {
    const systems = body.systems;
    if (!Array.isArray(systems) || systems.length === 0) {
      return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
    }
    if (!systems.every((s): s is string => typeof s === "string")) {
      return NextResponse.json({ error: "systems must be an array of strings" }, { status: 400 });
    }
    const invalidSystems = systems.filter((s) => !(VALID_SYSTEMS as readonly string[]).includes(s));
    if (invalidSystems.length > 0) {
      return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
    }
    updateData.systems = systems;
  }

  const metadataCategory =
    typeof updateData.category === "string" && updateData.category
      ? updateData.category
      : existing.category;
  const metadataParsed = parseOptionalMetadata(body, metadataCategory);
  if ("error" in metadataParsed) return NextResponse.json({ error: metadataParsed.error }, { status: 400 });
  if (metadataParsed.provided) updateData.metadata = metadataParsed.value;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ push });
}
