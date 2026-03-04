// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";
import {
  filterMetadataToSpecFields,
  generateZuperSpecification,
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getSpecTableName,
  getZuperCategoryValue,
} from "@/lib/catalog-fields";
import { createOrUpdateHubSpotProduct } from "@/lib/hubspot";
import { createOrUpdateZohoItem } from "@/lib/zoho-inventory";
import { createOrUpdateZuperPart } from "@/lib/zuper-catalog";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER", "QUICKBOOKS"] as const;

type SystemName = typeof VALID_SYSTEMS[number];
type SystemOutcomeStatus = "success" | "failed" | "skipped" | "not_implemented";

interface SystemOutcome {
  status: SystemOutcomeStatus;
  message?: string;
  externalId?: string | null;
}

type QuickBooksMatchOutcome =
  | { status: "matched"; externalId: string; name: string | null; strategy: "explicit" | "sku" | "name" }
  | { status: "ambiguous"; strategy: "sku" | "name"; candidates: Array<{ externalId: string; name: string | null }> }
  | { status: "no_match"; reason: string };

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

function compactUnique(values: Array<string | null | undefined>): string[] {
  const output = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) output.add(normalized);
  }
  return [...output];
}

async function resolveQuickBooksMatch(push: {
  brand: string;
  model: string;
  description: string;
  sku: string | null;
  vendorPartNumber: string | null;
  quickbooksItemId: string | null;
}): Promise<QuickBooksMatchOutcome> {
  if (!prisma) return { status: "no_match", reason: "Database is not configured." };

  const explicitQuickbooksItemId = String(push.quickbooksItemId || "").trim();
  if (explicitQuickbooksItemId) {
    const explicit = await prisma.catalogProduct.findUnique({
      where: {
        source_externalId: {
          source: "QUICKBOOKS",
          externalId: explicitQuickbooksItemId,
        },
      },
      select: { externalId: true, name: true },
    });
    if (explicit) {
      return {
        status: "matched",
        externalId: explicit.externalId,
        name: explicit.name,
        strategy: "explicit",
      };
    }
    return {
      status: "no_match",
      reason: `Selected QuickBooks item '${explicitQuickbooksItemId}' was not found in cached catalog.`,
    };
  }

  const skuCandidates = compactUnique([
    normalizeSku(push.sku),
    normalizeSku(push.vendorPartNumber),
    normalizeSku(push.model),
  ]);

  const nameCandidates = compactUnique([
    normalizeText(`${push.brand} ${push.model}`),
    normalizeText(push.model),
    normalizeText(push.description),
  ]);

  if (skuCandidates.length === 0 && nameCandidates.length === 0) {
    return { status: "no_match", reason: "No searchable SKU or name values were provided." };
  }

  const quickbooksRows = await prisma.catalogProduct.findMany({
    where: {
      source: "QUICKBOOKS",
      OR: [
        ...(skuCandidates.length > 0 ? [{ normalizedSku: { in: skuCandidates } }] : []),
        ...(nameCandidates.length > 0 ? [{ normalizedName: { in: nameCandidates } }] : []),
      ],
    },
    select: {
      externalId: true,
      name: true,
      normalizedSku: true,
      normalizedName: true,
    },
    take: 50,
  });

  const skuMatches = quickbooksRows.filter(
    (row) => row.normalizedSku && skuCandidates.includes(row.normalizedSku)
  );
  if (skuMatches.length === 1) {
    return {
      status: "matched",
      externalId: skuMatches[0].externalId,
      name: skuMatches[0].name,
      strategy: "sku",
    };
  }
  if (skuMatches.length > 1) {
    return {
      status: "ambiguous",
      strategy: "sku",
      candidates: skuMatches.map((row) => ({ externalId: row.externalId, name: row.name })),
    };
  }

  const nameMatches = quickbooksRows.filter(
    (row) => row.normalizedName && nameCandidates.includes(row.normalizedName)
  );
  if (nameMatches.length === 1) {
    return {
      status: "matched",
      externalId: nameMatches[0].externalId,
      name: nameMatches[0].name,
      strategy: "name",
    };
  }
  if (nameMatches.length > 1) {
    return {
      status: "ambiguous",
      strategy: "name",
      candidates: nameMatches.map((row) => ({ externalId: row.externalId, name: row.name })),
    };
  }

  return { status: "no_match", reason: "No QuickBooks catalog product matched this request." };
}

function makeSummary(outcomes: Partial<Record<SystemName, SystemOutcome>>) {
  const selected = Object.keys(outcomes).length;
  const counts = Object.values(outcomes).reduce(
    (acc, outcome) => {
      if (outcome.status === "success") acc.success += 1;
      if (outcome.status === "failed") acc.failed += 1;
      if (outcome.status === "skipped") acc.skipped += 1;
      if (outcome.status === "not_implemented") acc.notImplemented += 1;
      return acc;
    },
    { success: 0, failed: 0, skipped: 0, notImplemented: 0 }
  );

  return { selected, ...counts };
}

function shouldMarkApproved(summary: ReturnType<typeof makeSummary>): boolean {
  return summary.failed === 0 && summary.notImplemented === 0 && summary.skipped === 0;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  const selectedSystems = push.systems.filter((system): system is SystemName =>
    (VALID_SYSTEMS as readonly string[]).includes(system)
  );
  const outcomes: Partial<Record<SystemName, SystemOutcome>> = {};
  for (const system of selectedSystems) {
    outcomes[system] = { status: "skipped", message: "Pending processing." };
  }

  const quickbooksMatch = push.systems.includes("QUICKBOOKS")
    ? push.quickbooksItemId
      ? {
          status: "matched" as const,
          externalId: push.quickbooksItemId,
          name: null,
          strategy: "explicit" as const,
        }
      : await resolveQuickBooksMatch(push)
    : null;

  // Keep core internal writes atomic; final APPROVED status is set only if all
  // selected systems complete successfully.
  const basePush = await prisma.$transaction(async (tx) => {
    let internalSkuId: string | null = push.internalSkuId;
    let quickbooksItemId: string | null = push.quickbooksItemId;

    // INTERNAL catalog
    if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
      const parsedUnitSpec = push.unitSpec ? parseFloat(push.unitSpec) : null;
      const unitSpecValue = parsedUnitSpec != null && !isNaN(parsedUnitSpec) ? parsedUnitSpec : null;

      const commonFields = {
        description: push.description || null,
        unitSpec: unitSpecValue,
        unitLabel: push.unitLabel || null,
        sku: push.sku || null,
        vendorName: push.vendorName || null,
        vendorPartNumber: push.vendorPartNumber || null,
        unitCost: push.unitCost,
        sellPrice: push.sellPrice,
        hardToProcure: push.hardToProcure,
        length: push.length,
        width: push.width,
        weight: push.weight,
        ...(quickbooksMatch?.status === "matched"
          ? { quickbooksItemId: quickbooksMatch.externalId }
          : push.systems.includes("QUICKBOOKS")
            ? { quickbooksItemId: null }
            : {}),
      };

      // 1. Upsert EquipmentSku with all common fields
      const sku = await tx.equipmentSku.upsert({
        where: {
          category_brand_model: {
            category: push.category as EquipmentCategory,
            brand: push.brand,
            model: push.model,
          },
        },
        update: { isActive: true, ...commonFields },
        create: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
          ...commonFields,
        },
      });

      // 2. Write category spec table from metadata (if present)
      const rawMetadata = push.metadata as Record<string, unknown> | null;
      if (rawMetadata && Object.keys(rawMetadata).length > 0) {
        const specTable = getSpecTableName(push.category);
        if (specTable) {
          const specData = filterMetadataToSpecFields(push.category, rawMetadata);
          if (Object.keys(specData).length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prismaModel = (tx as any)[specTable];
            if (prismaModel?.upsert) {
              await prismaModel.upsert({
                where: { skuId: sku.id },
                create: { skuId: sku.id, ...specData },
                update: specData,
              });
            }
          }
        }
      }

      internalSkuId = sku.id;
      outcomes.INTERNAL = {
        status: "success",
        externalId: sku.id,
        message: "Saved to internal catalog.",
      };
    } else if (push.systems.includes("INTERNAL")) {
      outcomes.INTERNAL = {
        status: "skipped",
        message: `Category '${push.category}' is not supported by INTERNAL catalog.`,
      };
    }

    if (push.systems.includes("QUICKBOOKS")) {
      if (quickbooksMatch?.status === "matched") {
        quickbooksItemId = quickbooksMatch.externalId;
      } else if (!quickbooksItemId) {
        quickbooksItemId = null;
      }
    }

    // Persist latest internal and QuickBooks link IDs for retry-safe attempts.
    return tx.pendingCatalogPush.update({
      where: { id },
      data: {
        internalSkuId,
        quickbooksItemId,
      },
    });
  });

  if (push.systems.includes("HUBSPOT")) {
    if (basePush.hubspotProductId) {
      outcomes.HUBSPOT = {
        status: "success",
        externalId: basePush.hubspotProductId,
        message: "HubSpot product already linked on this request.",
      };
    } else {
      try {
      const metadata =
        push.metadata && typeof push.metadata === "object"
          ? (push.metadata as Record<string, unknown>)
          : null;
      const mappedMetadataProps = getHubspotPropertiesFromMetadata(push.category, metadata);
      const hubspotResult = await createOrUpdateHubSpotProduct({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        productCategory: getHubspotCategoryValue(push.category) || push.category,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        hardToProcure: push.hardToProcure,
        length: push.length,
        width: push.width,
        weight: push.weight,
        vendorName: push.vendorName,
        vendorPartNumber: push.vendorPartNumber,
        unitLabel: push.unitLabel,
        qboProductId: quickbooksMatch?.status === "matched" ? quickbooksMatch.externalId : null,
        additionalProperties: mappedMetadataProps,
      });

        await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { hubspotProductId: hubspotResult.hubspotProductId },
        });
          if (basePush.internalSkuId) {
          await tx.equipmentSku.update({
              where: { id: basePush.internalSkuId },
            data: { hubspotProductId: hubspotResult.hubspotProductId },
          });
        }
        return pendingPush;
      });

      outcomes.HUBSPOT = {
        status: "success",
        externalId: hubspotResult.hubspotProductId,
        message: hubspotResult.created
          ? "Created HubSpot product."
          : "Updated existing HubSpot product.",
      };
      } catch (error) {
        outcomes.HUBSPOT = {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "HubSpot product push failed.",
        };
      }
    }
  }

  if (push.systems.includes("QUICKBOOKS")) {
    if (!quickbooksMatch) {
      outcomes.QUICKBOOKS = {
        status: "failed",
        message: "QuickBooks matching was not executed.",
      };
    } else if (quickbooksMatch.status === "matched") {
      outcomes.QUICKBOOKS = {
        status: "success",
        externalId: quickbooksMatch.externalId,
        message:
          quickbooksMatch.strategy === "explicit"
            ? "Linked QuickBooks using selected item."
            : quickbooksMatch.strategy === "sku"
            ? "Linked QuickBooks by SKU match."
            : "Linked QuickBooks by name match.",
      };
    } else if (quickbooksMatch.status === "ambiguous") {
      outcomes.QUICKBOOKS = {
        status: "failed",
        message: `QuickBooks ${quickbooksMatch.strategy} match is ambiguous (${quickbooksMatch.candidates.length} candidates).`,
      };
    } else {
      outcomes.QUICKBOOKS = {
        status: "failed",
        message: quickbooksMatch.reason,
      };
    }
  }

  if (push.systems.includes("ZOHO")) {
    if (basePush.zohoItemId) {
      outcomes.ZOHO = {
        status: "success",
        externalId: basePush.zohoItemId,
        message: "Zoho item already linked on this request.",
      };
    } else {
      try {
      const zohoResult = await createOrUpdateZohoItem({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        unitLabel: push.unitLabel,
        vendorName: push.vendorName,
        vendorPartNumber: push.vendorPartNumber,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        weight: push.weight,
        length: push.length,
        width: push.width,
      });

        await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { zohoItemId: zohoResult.zohoItemId },
        });
          if (basePush.internalSkuId) {
          await tx.equipmentSku.update({
              where: { id: basePush.internalSkuId },
            data: { zohoItemId: zohoResult.zohoItemId },
          });
        }
        return pendingPush;
      });

      outcomes.ZOHO = {
        status: "success",
        externalId: zohoResult.zohoItemId,
        message: zohoResult.created
          ? "Created Zoho item."
          : "Updated existing Zoho item.",
      };
      } catch (error) {
        outcomes.ZOHO = {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Zoho product push failed.",
        };
      }
    }
  }
  if (push.systems.includes("ZUPER")) {
    if (basePush.zuperItemId) {
      outcomes.ZUPER = {
        status: "success",
        externalId: basePush.zuperItemId,
        message: "Zuper item already linked on this request.",
      };
    } else {
      try {
      const metadata =
        push.metadata && typeof push.metadata === "object"
          ? (push.metadata as Record<string, unknown>)
          : null;
      const specSummary =
        metadata && Object.keys(metadata).length > 0
          ? generateZuperSpecification(push.category, metadata)
          : undefined;

      const zuperResult = await createOrUpdateZuperPart({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        unitLabel: push.unitLabel,
        vendorName: push.vendorName,
        vendorPartNumber: push.vendorPartNumber,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        category: getZuperCategoryValue(push.category) || push.category,
        specification: specSummary,
      });

        await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { zuperItemId: zuperResult.zuperItemId },
        });
          if (basePush.internalSkuId) {
          await tx.equipmentSku.update({
              where: { id: basePush.internalSkuId },
            data: { zuperItemId: zuperResult.zuperItemId },
          });
        }
        return pendingPush;
      });

      outcomes.ZUPER = {
        status: "success",
        externalId: zuperResult.zuperItemId,
        message: zuperResult.created
          ? "Created Zuper item."
          : "Linked existing Zuper item.",
      };
      } catch (error) {
        outcomes.ZUPER = {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Zuper part push failed.",
        };
      }
    }
  }

  const summary = makeSummary(outcomes);
  const finalizeApproved = shouldMarkApproved(summary);

  const responsePush = await prisma.pendingCatalogPush.update({
    where: { id },
    data: finalizeApproved
      ? { status: "APPROVED", resolvedAt: new Date(), note: null }
      : {
          status: "PENDING",
          resolvedAt: null,
          note: "Approval attempt incomplete. Resolve failed/skipped systems and retry.",
        },
  });

  return NextResponse.json({
    push: responsePush,
    outcomes,
    summary,
    retryable: !finalizeApproved,
  });
}
