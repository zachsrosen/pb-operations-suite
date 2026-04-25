/**
 * Catalog Push Approval — shared core used by:
 *   - POST /api/catalog/push-requests (auto-approve on submit)
 *   - POST /api/catalog/push-requests/[id]/approve (admin retry)
 *
 * Runs the INTERNAL/HUBSPOT/ZOHO/ZUPER pushes selected on the PendingCatalogPush,
 * writes back external IDs, cross-links the systems, and finalizes status to
 * APPROVED only when every selected system succeeds. Partial failures leave the
 * row PENDING with a note so an admin can retry.
 */

import { prisma } from "@/lib/db";
import { EquipmentCategory } from "@/generated/prisma/enums";
import {
  filterMetadataToSpecFields,
  generateZuperSpecification,
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getSpecTableName,
  getZuperCategoryValue,
} from "@/lib/catalog-fields";
import { createOrUpdateHubSpotProduct, HubSpotManufacturerEnumError } from "@/lib/hubspot";
import { createOrUpdateZohoItem, uploadZohoItemImage } from "@/lib/zoho-inventory";
import { buildZuperCustomFieldsFromMetadata, createOrUpdateZuperPart } from "@/lib/zuper-catalog";
import { writeCrossLinkIds } from "@/lib/catalog-cross-link";
import { notifyAdminsOfApprovalWarnings } from "@/lib/catalog-notify";
import { buildCanonicalKey, canonicalToken } from "@/lib/canonical";
import { logCatalogSync, logCatalogProductCreated, CatalogSyncSource } from "@/lib/catalog-activity-log";

/**
 * Extract the blob pathname (e.g. "catalog-photos/foo.png") from the photoUrl
 * stored in PendingCatalogPush.metadata._photoUrl. The submit form stores an
 * internal viewer URL like "/api/catalog/photo?path=catalog-photos%2Ffoo.png".
 * Also accepts a bare pathname for forward-compat.
 */
function extractBlobPathname(photoUrl: string): string | null {
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;
  // Viewer URL with query-string pathname
  if (trimmed.includes("/api/catalog/photo")) {
    try {
      const parsed = new URL(trimmed, "http://local");
      const path = parsed.searchParams.get("path");
      return path && path.startsWith("catalog-photos/") ? path : null;
    } catch {
      return null;
    }
  }
  // Direct Vercel Blob URL
  if (trimmed.startsWith("http")) {
    try {
      const parsed = new URL(trimmed);
      const path = parsed.pathname.replace(/^\//, "");
      return path.startsWith("catalog-photos/") ? path : null;
    } catch {
      return null;
    }
  }
  // Bare pathname
  return trimmed.startsWith("catalog-photos/") ? trimmed : null;
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;

export type SystemName = typeof VALID_SYSTEMS[number];
export type SystemOutcomeStatus = "success" | "failed" | "skipped" | "not_implemented";

export interface SystemOutcome {
  status: SystemOutcomeStatus;
  message?: string;
  externalId?: string | null;
}

export interface ApprovalSummary {
  selected: number;
  success: number;
  failed: number;
  skipped: number;
  notImplemented: number;
}

export interface ApprovalResult {
  push: Awaited<ReturnType<NonNullable<typeof prisma>["pendingCatalogPush"]["update"]>> | null;
  outcomes: Partial<Record<SystemName, SystemOutcome>>;
  summary: ApprovalSummary;
  retryable: boolean;
  error?: string;
  notFound?: boolean;
  alreadyResolved?: { status: string };
}

function makeSummary(outcomes: Partial<Record<SystemName, SystemOutcome>>): ApprovalSummary {
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

function shouldMarkApproved(summary: ApprovalSummary): boolean {
  return summary.failed === 0 && summary.notImplemented === 0 && summary.skipped === 0;
}

export async function executeCatalogPushApproval(
  id: string,
  options: { source?: CatalogSyncSource; userEmail?: string } = {}
): Promise<ApprovalResult> {
  if (!prisma) {
    return {
      push: null,
      outcomes: {},
      summary: { selected: 0, success: 0, failed: 1, skipped: 0, notImplemented: 0 },
      retryable: true,
      error: "Database not configured",
    };
  }

  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) {
    return {
      push: null,
      outcomes: {},
      summary: { selected: 0, success: 0, failed: 0, skipped: 0, notImplemented: 0 },
      retryable: false,
      notFound: true,
    };
  }
  if (push.status !== "PENDING") {
    return {
      push: null,
      outcomes: {},
      summary: { selected: 0, success: 0, failed: 0, skipped: 0, notImplemented: 0 },
      retryable: false,
      alreadyResolved: { status: push.status },
    };
  }

  const startedAt = Date.now();

  const selectedSystems = push.systems.filter((system): system is SystemName =>
    (VALID_SYSTEMS as readonly string[]).includes(system)
  );
  const outcomes: Partial<Record<SystemName, SystemOutcome>> = {};
  for (const system of selectedSystems) {
    outcomes[system] = { status: "skipped", message: "Pending processing." };
  }

  // Keep core internal writes atomic; final APPROVED status is set only if all
  // selected systems complete successfully.
  let wasInternalCreate = false;
  const basePush = await prisma.$transaction(async (tx) => {
    let internalSkuId: string | null = push.internalSkuId;

    if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
      const parsedUnitSpec = push.unitSpec ? parseFloat(push.unitSpec) : null;
      const unitSpecValue = parsedUnitSpec != null && !isNaN(parsedUnitSpec) ? parsedUnitSpec : null;

      const cBrand = canonicalToken(push.brand);
      const cModel = canonicalToken(push.model);
      const cKey = buildCanonicalKey(push.category, push.brand, push.model);

      const parseOptFloat = (v: unknown): number | null => {
        if (v == null) return null;
        const n = parseFloat(String(v));
        return isNaN(n) ? null : n;
      };

      const commonFields = {
        description: push.description || null,
        unitSpec: unitSpecValue,
        unitLabel: push.unitLabel || null,
        sku: push.sku || null,
        vendorName: push.vendorName || null,
        zohoVendorId: push.zohoVendorId,
        vendorPartNumber: push.vendorPartNumber || null,
        unitCost: parseOptFloat(push.unitCost),
        sellPrice: parseOptFloat(push.sellPrice),
        hardToProcure: push.hardToProcure,
        length: parseOptFloat(push.length),
        width: parseOptFloat(push.width),
        weight: parseOptFloat(push.weight),
        canonicalBrand: cBrand || null,
        canonicalModel: cModel || null,
        canonicalKey: cKey,
      };

      // Check existence before upsert so we can distinguish create from update for audit logging.
      const existing = await tx.internalProduct.findUnique({
        where: {
          category_brand_model: {
            category: push.category as EquipmentCategory,
            brand: push.brand,
            model: push.model,
          },
        },
        select: { id: true },
      });
      wasInternalCreate = existing === null;

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

    return tx.pendingCatalogPush.update({
      where: { id },
      data: { internalSkuId },
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
        if (error instanceof HubSpotManufacturerEnumError) {
          outcomes.HUBSPOT = {
            status: "failed",
            message: `Brand "${error.brand}" is not in HubSpot's manufacturer enum. Add it in HubSpot Settings → Properties → Products → Manufacturer (or correct the brand spelling), then retry.`,
          };
        } else {
          outcomes.HUBSPOT = {
            status: "failed",
            message:
              error instanceof Error ? error.message : "HubSpot product push failed.",
          };
        }
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
            error instanceof Error ? error.message : "Zoho product push failed.",
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
          length: push.length,
          width: push.width,
          weight: push.weight,
          customFields: buildZuperCustomFieldsFromMetadata(push.category, metadata),
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
            error instanceof Error ? error.message : "Zuper part push failed.",
        };
      }
    }
  }

  // Cross-link: write each system's ID into the others' custom-fields/properties.
  const zohoId = outcomes.ZOHO?.externalId || basePush.zohoItemId;
  const zuperId = outcomes.ZUPER?.externalId || basePush.zuperItemId;
  const hsId = outcomes.HUBSPOT?.externalId || basePush.hubspotProductId;
  const internalSkuId = basePush.internalSkuId;

  const crossLink = await writeCrossLinkIds({
    zohoItemId: zohoId,
    zuperItemId: zuperId,
    hubspotProductId: hsId,
    internalProductId: internalSkuId,
  });

  // Append cross-link warnings to the originating system's outcome message.
  for (const warning of crossLink.warnings) {
    const sys = warning.startsWith("Zoho") ? outcomes.ZOHO
      : warning.startsWith("Zuper") ? outcomes.ZUPER
      : warning.startsWith("HubSpot") ? outcomes.HUBSPOT
      : null;
    if (sys?.message) sys.message += ` (Warning: ${warning})`;
  }

  // Push the product photo (if any) to Zoho Inventory.
  // The submit form stores an internal viewer URL (/api/catalog/photo?path=…)
  // on metadata._photoUrl. Fetch the private blob server-side and POST it to
  // /items/{item_id}/image. Image upload failures are warnings — they don't
  // fail the overall approval.
  if (zohoId && push.systems.includes("ZOHO")) {
    const rawPhotoUrl = (push.metadata as Record<string, unknown> | null)?._photoUrl;
    if (typeof rawPhotoUrl === "string" && rawPhotoUrl.length > 0) {
      const pathname = extractBlobPathname(rawPhotoUrl);
      if (!pathname) {
        if (outcomes.ZOHO?.message) {
          outcomes.ZOHO.message += ` (Warning: photo URL not recognized — skipping Zoho image push.)`;
        }
      } else {
        try {
          // Lazy import: @vercel/blob pulls undici which can fail in jsdom test envs.
          const { get: getBlob } = await import("@vercel/blob");
          const blobResult = await getBlob(pathname, { access: "private" });
          if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
            if (outcomes.ZOHO?.message) {
              outcomes.ZOHO.message += ` (Warning: could not read product photo from Blob — skipping Zoho image push.)`;
            }
          } else {
            const bytes = await streamToUint8Array(blobResult.stream);
            const contentType = blobResult.blob?.contentType || "image/png";
            const fileName = pathname.split("/").pop() || "photo";
            const uploadResult = await uploadZohoItemImage(zohoId, bytes, fileName, contentType);
            if (uploadResult.status !== "uploaded") {
              if (outcomes.ZOHO?.message) {
                outcomes.ZOHO.message += ` (Warning: Zoho image upload failed — ${uploadResult.message})`;
              }
            } else if (outcomes.ZOHO?.message) {
              outcomes.ZOHO.message += ` Image uploaded (${uploadResult.imageName || fileName}).`;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error("[catalog] Zoho image upload failed:", msg, err);
          if (outcomes.ZOHO?.message) {
            outcomes.ZOHO.message += ` (Warning: Zoho image upload failed — ${msg})`;
          }
        }
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

  // Audit logging: write ActivityLog row and bump sync watermark.
  if (basePush.internalSkuId) {
    const effectiveUserEmail = options.userEmail || push.requestedBy;
    const effectiveSource = options.source || "wizard";
    const productName = `${push.brand} ${push.model}`.trim();

    // logCatalogSync — fire-and-forget, never fail the overall response
    logCatalogSync({
      internalProductId: basePush.internalSkuId,
      productName,
      userEmail: effectiveUserEmail,
      source: effectiveSource,
      outcomes,
      durationMs: Date.now() - startedAt,
      ...(push.dealId ? { dealId: push.dealId } : {}),
    }).catch((err) => {
      console.warn("[catalog] logCatalogSync failed (non-fatal):", err);
    });

    // Bump lastSyncedAt / lastSyncedBy watermark on the InternalProduct row.
    prisma.internalProduct
      .update({
        where: { id: basePush.internalSkuId },
        data: {
          lastSyncedAt: new Date(),
          lastSyncedBy: effectiveUserEmail,
        },
      })
      .catch((err) => {
        console.warn("[catalog] lastSyncedAt watermark update failed (non-fatal):", err);
      });

    // logCatalogProductCreated — only when this approval created a new InternalProduct row
    if (wasInternalCreate) {
      logCatalogProductCreated({
        internalProductId: basePush.internalSkuId,
        category: push.category,
        brand: push.brand,
        model: push.model,
        userEmail: effectiveUserEmail,
        source: effectiveSource,
      }).catch((err) => {
        console.warn("[catalog] logCatalogProductCreated failed (non-fatal):", err);
      });
    }
  }

  return {
    push: responsePush,
    outcomes,
    summary,
    retryable: !finalizeApproved,
  };
}
