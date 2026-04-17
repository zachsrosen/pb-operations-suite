import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import {
  buildZuperProductCustomFields,
  getZuperHubSpotProductFieldKey,
  getZuperHubSpotProductFieldLabel,
  getZuperPartById,
  readZuperCustomFieldValue,
  updateZuperPart,
} from "@/lib/zuper-catalog";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

function isTruthyParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.role ?? authResult.role) as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? authResult.role) as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const products = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      hubspotProductId: { not: null },
      zuperItemId: { not: null },
      NOT: [
        { hubspotProductId: "" },
        { zuperItemId: "" },
      ],
    },
    select: {
      id: true,
      brand: true,
      model: true,
      hubspotProductId: true,
      zuperItemId: true,
    },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  const fieldKey = getZuperHubSpotProductFieldKey();
  const fieldLabel = getZuperHubSpotProductFieldLabel();
  const dryRun = isTruthyParam(request.nextUrl.searchParams.get("dryRun"));
  const result = {
    dryRun,
    total: products.length,
    updated: 0,
    wouldUpdate: 0,
    alreadySet: 0,
    failed: 0,
    items: [] as Array<{
      internalProductId: string;
      brand: string;
      model: string;
      zuperItemId: string;
      hubspotProductId: string;
      status: "updated" | "would_update" | "already_set" | "failed";
      message?: string;
    }>,
  };

  for (const product of products) {
    const internalProductId = product.id;
    const brand = String(product.brand || "");
    const model = String(product.model || "");
    const zuperItemId = String(product.zuperItemId || "");
    const hubspotProductId = String(product.hubspotProductId || "");

    try {
      const item = await getZuperPartById(zuperItemId);
      const zuperData = item as Record<string, unknown>;
      const customFieldSource = zuperData?.meta_data ?? zuperData?.custom_fields;
      const currentValue = item
        ? readZuperCustomFieldValue(customFieldSource, fieldKey, [fieldLabel])
        : null;

      if (currentValue === hubspotProductId) {
        result.alreadySet += 1;
        result.items.push({
          internalProductId,
          brand,
          model,
          zuperItemId,
          hubspotProductId,
          status: "already_set",
        });
        continue;
      }

      const customFields = buildZuperProductCustomFields({ hubspotProductId });
      if (!customFields) {
        result.failed += 1;
        result.items.push({
          internalProductId,
          brand,
          model,
          zuperItemId,
          hubspotProductId,
          status: "failed",
          message: "Missing HubSpot product ID.",
        });
        continue;
      }

      if (dryRun) {
        result.wouldUpdate += 1;
        result.items.push({
          internalProductId,
          brand,
          model,
          zuperItemId,
          hubspotProductId,
          status: "would_update",
        });
        continue;
      }

      const updateResult = await updateZuperPart(zuperItemId, { custom_fields: customFields });
      if (updateResult.status === "updated") {
        result.updated += 1;
        result.items.push({
          internalProductId,
          brand,
          model,
          zuperItemId,
          hubspotProductId,
          status: "updated",
        });
      } else {
        result.failed += 1;
        result.items.push({
          internalProductId,
          brand,
          model,
          zuperItemId,
          hubspotProductId,
          status: "failed",
          message: updateResult.message,
        });
      }
    } catch (error) {
      result.failed += 1;
      result.items.push({
        internalProductId,
        brand,
        model,
        zuperItemId,
        hubspotProductId,
        status: "failed",
        message: error instanceof Error ? error.message : "Backfill failed.",
      });
    }
  }

  console.info(
    `[Zuper HubSpot Backfill] dryRun=${result.dryRun} total=${result.total} updated=${result.updated} wouldUpdate=${result.wouldUpdate} alreadySet=${result.alreadySet} failed=${result.failed}`
  );

  return NextResponse.json(result);
}
