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
import { createOrUpdateZohoItem, zohoInventory } from "@/lib/zoho-inventory";
import { createOrUpdateZuperPart, updateZuperPart, buildZuperProductCustomFields } from "@/lib/zuper-catalog";
import { notifyAdminsOfApprovalWarnings } from "@/lib/catalog-notify";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;

type SystemName = typeof VALID_SYSTEMS[number];
type SystemOutcomeStatus = "success" | "failed" | "skipped" | "not_implemented";

interface SystemOutcome {
  status: SystemOutcomeStatus;
  message?: string;
  externalId?: string | null;
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

function compactUnique(values: Array<string | null | undefined>): string[] {
  const output = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) output.add(normalized);
  }
  return [...output];
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

  try {
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

  // Keep core internal writes atomic; final APPROVED status is set only if all
  // selected systems complete successfully.
  const basePush = await prisma.$transaction(async (tx) => {
    let internalSkuId: string | null = push.internalSkuId;

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
        zohoVendorId: push.zohoVendorId,
        vendorPartNumber: push.vendorPartNumber || null,
        unitCost: push.unitCost,
        sellPrice: push.sellPrice,
        hardToProcure: push.hardToProcure,
        length: push.length,
        width: push.width,
        weight: push.weight,
      };

      // 1. Upsert InternalProduct with all common fields
      const sku = await tx.internalProduct.upsert({
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
                where: { internalProductId: sku.id },
                create: { internalProductId: sku.id, ...specData },
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

    // Persist latest internal link ID for retry-safe attempts.
    return tx.pendingCatalogPush.update({
      where: { id },
      data: {
        internalSkuId,
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
        internalProductId: basePush.internalSkuId,
        additionalProperties: mappedMetadataProps,
      });

        await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { hubspotProductId: hubspotResult.hubspotProductId },
        });
          if (basePush.internalSkuId) {
          await tx.internalProduct.update({
              where: { id: basePush.internalSkuId },
            data: { hubspotProductId: hubspotResult.hubspotProductId },
          });
        }
        return pendingPush;
      });

      const hubspotWarnings = hubspotResult.warnings?.length
        ? ` (Warning: ${hubspotResult.warnings.join("; ")})`
        : "";
      outcomes.HUBSPOT = {
        status: "success",
        externalId: hubspotResult.hubspotProductId,
        message: (hubspotResult.created
          ? "Created HubSpot product."
          : "Updated existing HubSpot product.") + hubspotWarnings,
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
        zohoVendorId: push.zohoVendorId,
        vendorPartNumber: push.vendorPartNumber,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        weight: push.weight,
        length: push.length,
        width: push.width,
        category: push.category,
        internalProductId: basePush.internalSkuId,
      });

        await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { zohoItemId: zohoResult.zohoItemId },
        });
          if (basePush.internalSkuId) {
          await tx.internalProduct.update({
              where: { id: basePush.internalSkuId },
            data: { zohoItemId: zohoResult.zohoItemId },
          });
        }
        return pendingPush;
      });

      const zohoWarnings = zohoResult.warnings?.length
        ? ` (Warning: ${zohoResult.warnings.join("; ")})`
        : "";
      outcomes.ZOHO = {
        status: "success",
        externalId: zohoResult.zohoItemId,
        message: (zohoResult.created
          ? "Created Zoho item."
          : "Updated existing Zoho item.") + zohoWarnings,
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
          await tx.internalProduct.update({
              where: { id: basePush.internalSkuId },
            data: { zuperItemId: zuperResult.zuperItemId },
          });
        }
        return pendingPush;
      });

      const zuperWarnings = zuperResult.warnings?.length
        ? ` (Warning: ${zuperResult.warnings.join("; ")})`
        : "";
      outcomes.ZUPER = {
        status: "success",
        externalId: zuperResult.zuperItemId,
        message: (zuperResult.created
          ? "Created Zuper item."
          : "Linked existing Zuper item.") + zuperWarnings,
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

  // Cross-link: write Zuper, HubSpot, and Internal Product IDs to Zoho item custom fields.
  const zohoId = outcomes.ZOHO?.externalId || basePush.zohoItemId;
  const zuperId = outcomes.ZUPER?.externalId || basePush.zuperItemId;
  const hsId = outcomes.HUBSPOT?.externalId || basePush.hubspotProductId;
  const internalSkuId = basePush.internalSkuId;
  if (zohoId && (zuperId || hsId || internalSkuId)) {
    try {
      const customFields: Array<{ api_name: string; value: string }> = [];
      if (zuperId) customFields.push({ api_name: "cf_zuper_product_id", value: zuperId });
      if (hsId) customFields.push({ api_name: "cf_hubspot_product_id", value: hsId });
      if (internalSkuId) customFields.push({ api_name: "cf_internal_product_id", value: internalSkuId });
      if (customFields.length > 0) {
        const zohoResult = await zohoInventory.updateItem(zohoId, { custom_fields: customFields });
        if (zohoResult.status !== "updated") {
          const msg = `Zoho cross-link update returned ${zohoResult.status}: ${zohoResult.message || "unknown"}`;
          if (outcomes.ZOHO?.message) outcomes.ZOHO.message += ` (Warning: ${msg})`;
        }
      }
    } catch {
      const msg = "Could not write custom field cross-links to Zoho item";
      if (outcomes.ZOHO?.message) {
        outcomes.ZOHO.message += ` (Warning: ${msg})`;
      }
    }
  }

  // Cross-link: write HubSpot, Zoho, and Internal Product IDs to Zuper product custom fields.
  if (zuperId && (hsId || zohoId || internalSkuId)) {
    try {
      const zuperCustomFields = buildZuperProductCustomFields({
        hubspotProductId: hsId,
        zohoItemId: zohoId,
        internalProductId: internalSkuId,
      });
      if (zuperCustomFields) {
        const zuperResult = await updateZuperPart(zuperId, { custom_fields: zuperCustomFields });
        if (zuperResult.status !== "updated") {
          const msg = `Zuper cross-link update returned ${zuperResult.status}: ${zuperResult.message || "unknown"}`;
          if (outcomes.ZUPER?.message) {
            outcomes.ZUPER.message += ` (Warning: ${msg})`;
          }
        }
      }
    } catch {
      const msg = "Could not write cross-link IDs to Zuper product";
      if (outcomes.ZUPER?.message) {
        outcomes.ZUPER.message += ` (Warning: ${msg})`;
      }
    }
  }

  // Cross-link: write Zuper, Zoho, and Internal Product IDs to HubSpot product properties.
  if (hsId && (zuperId || zohoId || internalSkuId)) {
    try {
      const hsProps: Record<string, string> = {};
      if (zuperId) hsProps.zuper_item_id = zuperId;
      if (zohoId) hsProps.zoho_item_id = zohoId;
      if (internalSkuId) hsProps.internal_product_id = internalSkuId;
      if (Object.keys(hsProps).length > 0) {
        const token = process.env.HUBSPOT_ACCESS_TOKEN;
        if (token) {
          const hsRes = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${hsId}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ properties: hsProps }),
          });
          if (!hsRes.ok) {
            const msg = `HubSpot cross-link PATCH returned ${hsRes.status}`;
            if (outcomes.HUBSPOT?.message) outcomes.HUBSPOT.message += ` (Warning: ${msg})`;
          }
        }
      }
    } catch {
      const msg = "Could not write cross-link IDs to HubSpot product";
      if (outcomes.HUBSPOT?.message) {
        outcomes.HUBSPOT.message += ` (Warning: ${msg})`;
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

  // Collect warnings from all system outcomes and notify admins — only if fully approved
  if (finalizeApproved) {
    const systemWarnings: Record<string, string[]> = {};
    for (const [system, outcome] of Object.entries(outcomes)) {
      if (outcome?.status === "success" && outcome.message?.includes("Warning:")) {
        const warningMatch = outcome.message.match(/\(Warning: (.+)\)$/);
        if (warningMatch) {
          systemWarnings[system] = [warningMatch[1]];
        }
      }
    }
    if (Object.keys(systemWarnings).length > 0) {
      notifyAdminsOfApprovalWarnings({
        id,
        brand: push.brand,
        model: push.model,
        category: push.category,
        systemWarnings,
      });
    }
  }

  return NextResponse.json({
    push: responsePush,
    outcomes,
    summary,
    retryable: !finalizeApproved,
  });

  } catch (error) {
    console.error("[catalog] Approval failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Approval failed unexpectedly",
        push: null,
        outcomes: {},
        summary: { selected: 0, success: 0, failed: 1, skipped: 0, notImplemented: 0 },
        retryable: true,
      },
      { status: 500 }
    );
  }
}
