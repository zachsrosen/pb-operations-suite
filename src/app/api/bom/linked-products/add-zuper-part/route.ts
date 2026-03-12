import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";
import { notifyAdminsOfNewCatalogRequest } from "@/lib/catalog-notify";

const ALLOWED_ROLES = new Set([
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

function parseOptionalString(input: Record<string, unknown>, key: string): string | null {
  if (!(key in input)) return null;
  const raw = input[key];
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

function parsePositiveNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  if (!(key in input)) return fallback;
  const parsed = Number(input[key]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isPrismaMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2022";
}

async function loadSku(skuId: string | null, category: string | null, brand: string | null, model: string | null) {
  if (!prisma) return null;

  const fullSelect = {
    id: true,
    category: true,
    brand: true,
    model: true,
    description: true,
    vendorPartNumber: true,
    sellPrice: true,
    zuperItemId: true,
  } as const;

  const legacySelect = {
    id: true,
    category: true,
    brand: true,
    model: true,
    unitSpec: true,
    unitLabel: true,
    updatedAt: true,
  } as const;

  const where = skuId
    ? { id: skuId }
    : (brand && model
      ? { brand, model }
      : null);

  if (!where) return null;

  const pickBest = <T extends { category: string }>(rows: T[]): T | null => {
    if (!rows.length) return null;
    if (!category) return rows[0];
    const exact = rows.find((row) => row.category === category);
    return exact || rows[0];
  };

  try {
    if (skuId) {
      return await prisma.equipmentSku.findFirst({ where, select: fullSelect });
    }
    const rows = await prisma.equipmentSku.findMany({
      where,
      select: fullSelect,
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    return pickBest(rows);
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;
    if (skuId) {
      const legacy = await prisma.equipmentSku.findFirst({ where, select: legacySelect });
      if (!legacy) return null;
      return {
        ...legacy,
        description: null,
        vendorPartNumber: null,
        sellPrice: null,
        zuperItemId: null,
      };
    }
    const legacyRows = await prisma.equipmentSku.findMany({
      where,
      select: legacySelect,
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    const legacy = pickBest(legacyRows);
    if (!legacy) return null;
    return {
      ...legacy,
      description: null,
      vendorPartNumber: null,
      sellPrice: null,
      zuperItemId: null,
    };
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobUid = parseOptionalString(body, "jobUid");
  if (!jobUid) return NextResponse.json({ error: "jobUid is required" }, { status: 400 });

  const skuId = parseOptionalString(body, "skuId");
  const category = parseOptionalString(body, "category");
  const brand = parseOptionalString(body, "brand");
  const model = parseOptionalString(body, "model");
  const explicitName = parseOptionalString(body, "name");
  const explicitDescription = parseOptionalString(body, "description");
  const explicitSku = parseOptionalString(body, "sku");
  const explicitZuperItemId = parseOptionalString(body, "zuperItemId");
  const quantity = parsePositiveNumber(body, "quantity", 1);
  const unitPrice = parsePositiveNumber(body, "unitPrice", NaN);

  const skuRecord = await loadSku(skuId, category, brand, model);

  const partName =
    explicitName ||
    [brand || skuRecord?.brand || "", model || skuRecord?.model || ""].filter(Boolean).join(" ").trim() ||
    explicitDescription ||
    skuRecord?.description ||
    "BOM Item";

  const description = explicitDescription || skuRecord?.description || null;
  const sku = explicitSku || skuRecord?.vendorPartNumber || model || skuRecord?.model || null;
  const zuperItemId = explicitZuperItemId || skuRecord?.zuperItemId || null;
  // If no Zuper product exists, queue a catalog push request for approval
  const resolvedBrand = (brand || skuRecord?.brand || "").trim() || null;
  const resolvedModel = (model || skuRecord?.model || "").trim() || null;
  if (!zuperItemId && prisma && (resolvedBrand || resolvedModel)) {
    try {
      // De-dup: atomic find-or-create inside a serializable transaction.
      // Retry up to 3 times on serialization conflicts (Prisma error P2034).
      let result: { push: NonNullable<Awaited<ReturnType<typeof prisma.pendingCatalogPush.findFirst>>>; created: boolean };
      for (let attempt = 0; ; attempt++) {
        try {
          result = await prisma.$transaction(async (tx) => {
            const existing = await tx.pendingCatalogPush.findFirst({
              where: {
                brand: resolvedBrand || "",
                model: resolvedModel || "",
                systems: { has: "ZUPER" },
                status: "PENDING",
              },
            });
            if (existing) return { push: existing, created: false };
            const created = await tx.pendingCatalogPush.create({
              data: {
                brand: resolvedBrand || "",
                model: resolvedModel || "",
                description: description || partName,
                category: category || skuRecord?.category || "Uncategorized",
                sku: sku || undefined,
                sellPrice: Number.isFinite(unitPrice) ? unitPrice : (skuRecord?.sellPrice ?? null),
                systems: ["ZUPER"],
                requestedBy: authResult.email,
                metadata: { source: "bom_push", jobUid },
              },
            });
            return { push: created, created: true };
          }, { isolationLevel: "Serializable" });
          break;
        } catch (txErr: unknown) {
          const isSerializationConflict = txErr instanceof Error && "code" in txErr && (txErr as { code: string }).code === "P2034";
          if (isSerializationConflict && attempt < 2) continue;
          throw txErr;
        }
      }
      const { push } = result;
      if (result.created) {
        notifyAdminsOfNewCatalogRequest({
          id: push.id,
          brand: push.brand,
          model: push.model,
          category: push.category,
          requestedBy: push.requestedBy,
          systems: push.systems,
        });
      }
      return NextResponse.json({
        ok: false,
        pendingApproval: true,
        pushRequestId: push.id,
        message: `Product "${[resolvedBrand, resolvedModel].filter(Boolean).join(" ")}" not found in Zuper. Sent to catalog approvals.`,
      }, { status: 202 });
    } catch (pushError) {
      const msg = pushError instanceof Error ? pushError.message : String(pushError);
      return NextResponse.json(
        { error: `Product not found in Zuper and failed to queue approval: ${msg}` },
        { status: 502 }
      );
    }
  }

  if (!zuperItemId) {
    return NextResponse.json(
      { error: "Cannot add part without a linked Zuper product. Provide brand/model or zuperItemId." },
      { status: 400 }
    );
  }

  const result = await zuper.addPartToJob(jobUid, {
    itemUid: zuperItemId,
    name: partName,
    quantity,
    description,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : (skuRecord?.sellPrice ?? null),
    sku,
  });

  if (result.type === "error") {
    return NextResponse.json({ error: result.error || "Failed to add Zuper part" }, { status: 502 });
  }

  // Keep linkage in sync when caller provides a part/item ID and SKU exists.
  if (prisma && skuRecord?.id && explicitZuperItemId && !skuRecord.zuperItemId) {
    try {
      await prisma.equipmentSku.update({
        where: { id: skuRecord.id },
        data: { zuperItemId: explicitZuperItemId },
      });
    } catch (updateError) {
      if (!isPrismaMissingColumnError(updateError)) throw updateError;
    }
  }

  return NextResponse.json({
    ok: true,
    mode: result.data?.mode || "part_added",
    endpoint: result.data?.endpoint || null,
    warning: result.data?.warning || null,
    skuId: skuRecord?.id || null,
    usedZuperItemId: zuperItemId,
  });
}
