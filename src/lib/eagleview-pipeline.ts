/**
 * EagleView TrueDesign auto-pull pipeline orchestrator.
 *
 * Two entry points:
 *
 *   1. orderTrueDesign(dealId, opts)
 *      - Reads deal address from HubSpot
 *      - Idempotent claim against (dealId, TDP, addressHash)
 *      - Calls EagleView availability + placeOrder
 *      - Returns order metadata. Files come later via FileDelivery webhook OR
 *        the cron poller.
 *
 *   2. fetchAndStoreDeliverables(reportId)
 *      - Fetches signed URLs via getFileLinks
 *      - Downloads each file and uploads to Drive
 *      - Updates the EagleViewOrder row to DELIVERED
 *
 * Both use dependency injection (`PipelineDeps`) so tests can mock the
 * EagleView client, Drive helpers, HubSpot helpers, and DB without spinning
 * up actual integrations.
 */
import * as Sentry from "@sentry/nextjs";
import {
  EAGLEVIEW_PRODUCT_ID,
  EagleViewClient,
  type AddressInput,
  type FileLinksResponse,
  type ReportFileLink,
} from "@/lib/eagleview";
import type { AddressParts } from "@/lib/address-hash";
import type { PrismaClient } from "@/generated/prisma/client";
import { claimOrder } from "@/lib/eagleview-dedup";

// ============================================================
// Types
// ============================================================

export interface OrderTrueDesignInput {
  dealId: string;
  triggeredBy: string;
  surveyDate?: Date | null;
}

export interface OrderTrueDesignResult {
  orderId: string; // Our DB row id
  reportId: string; // EagleView's ReportId (or "pending:..." if claim was a no-op)
  status: "ORDERED" | "DELIVERED" | "FAILED" | "CANCELLED";
  isNew: boolean; // false if duplicate claim hit existing row
  /** Reason populated when status === "FAILED". */
  reason?: string;
}

export interface FetchDeliverablesResult {
  status: "DELIVERED" | "FAILED" | "SKIPPED";
  reason?: string;
  driveFolderId?: string;
}

/** Subset of HubSpot deal fields we read for an order. */
export interface DealAddressFields {
  address: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  /** Pre-geocoded if HubSpot has it; otherwise pipeline geocodes. */
  latitude: number | null;
  longitude: number | null;
  /** Preferred Drive folder for design docs (deal property). */
  driveDesignDocumentsFolderId: string | null;
  /** Fallback parent folder. */
  driveAllDocumentsFolderId: string | null;
}

export interface PipelineDeps {
  prisma: Pick<PrismaClient, "eagleViewOrder">;
  client: Pick<
    EagleViewClient,
    "checkSolarAvailability" | "placeOrder" | "getFileLinks" | "downloadFile" | "getReport"
  >;
  /** Read deal address from HubSpot. */
  fetchDealAddress: (dealId: string) => Promise<DealAddressFields | null>;
  /** Geocode an address to lat/lng. Pipeline only calls this if HubSpot didn't provide. */
  geocode: (address: string) => Promise<{ latitude: number; longitude: number } | null>;
  /** Resolve / create the Drive folder for this order. Returns the folder ID. */
  ensureDriveFolder: (
    dealId: string,
    parentFolderId: string,
    folderName: string,
  ) => Promise<string>;
  /** Upload a binary blob to Drive. Returns the new file ID. */
  uploadToDrive: (
    parentId: string,
    filename: string,
    bytes: ArrayBuffer,
    mimeType: string,
  ) => Promise<{ id: string; name: string }>;
  /** Post a note on the HubSpot deal timeline. Best-effort; log on failure. */
  postDealNote: (dealId: string, body: string) => Promise<void>;
}

// ============================================================
// Order placement
// ============================================================

export async function orderTrueDesign(
  deps: PipelineDeps,
  input: OrderTrueDesignInput,
): Promise<OrderTrueDesignResult> {
  // 1. Fetch address from HubSpot
  const dealFields = await deps.fetchDealAddress(input.dealId);
  if (!dealFields) {
    return failWithoutClaim(deps.prisma, input, "deal_not_found");
  }

  const addressParts: AddressParts = {
    street: dealFields.address,
    unit: dealFields.address2 ?? null,
    city: dealFields.city,
    state: dealFields.state,
    zip: dealFields.zip,
  };

  if (!addressParts.street || !addressParts.city || !addressParts.zip) {
    return failWithoutClaim(deps.prisma, input, "address_incomplete");
  }

  // 2. Idempotency claim (atomic insert-or-fetch-existing)
  const claim = await claimOrder(deps.prisma, {
    dealId: input.dealId,
    productCode: "TDP",
    address: addressParts,
    triggeredBy: input.triggeredBy,
    surveyDate: input.surveyDate ?? null,
  });

  if (!claim.isNew) {
    return {
      orderId: claim.order.id,
      reportId: claim.order.reportId,
      status: claim.order.status as OrderTrueDesignResult["status"],
      isNew: false,
    };
  }

  // 3. Geocode if needed
  let { latitude, longitude } = dealFields;
  if (latitude == null || longitude == null) {
    const formatted = formatAddressOneLine(addressParts);
    const geo = await deps.geocode(formatted).catch(() => null);
    if (!geo) {
      await markFailed(deps.prisma, claim.order.id, "geocode_failed");
      return {
        orderId: claim.order.id,
        reportId: claim.order.reportId,
        status: "FAILED",
        isNew: true,
        reason: "geocode_failed",
      };
    }
    latitude = geo.latitude;
    longitude = geo.longitude;
  }

  const evAddress: AddressInput = {
    address: formatAddressOneLine(addressParts),
    latitude,
    longitude,
  };

  // 4. Availability check
  try {
    const avail = await deps.client.checkSolarAvailability(evAddress, [
      EAGLEVIEW_PRODUCT_ID.TDP,
    ]);
    const tdp = avail.availabilityStatus.find(
      (s) => s.productId === EAGLEVIEW_PRODUCT_ID.TDP,
    );
    if (!tdp?.isAvailable) {
      await markFailed(deps.prisma, claim.order.id, "tdp_unavailable_at_address");
      return {
        orderId: claim.order.id,
        reportId: claim.order.reportId,
        status: "FAILED",
        isNew: true,
        reason: "tdp_unavailable_at_address",
      };
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "availability" },
      extra: { dealId: input.dealId, orderId: claim.order.id },
    });
    await markFailed(deps.prisma, claim.order.id, "availability_check_failed");
    return {
      orderId: claim.order.id,
      reportId: claim.order.reportId,
      status: "FAILED",
      isNew: true,
      reason: "availability_check_failed",
    };
  }

  // 5. Place the order
  let realReportId: string;
  try {
    const placed = await deps.client.placeOrder({
      reportAddresses: {
        primary: {
          street: addressParts.street,
          city: addressParts.city,
          state: addressParts.state,
          zip: addressParts.zip,
          country: "United States",
        },
      },
      primaryProductId: EAGLEVIEW_PRODUCT_ID.TDP,
      // EagleView's "Regular" delivery (productId 8); upgrade-rush products are
      // separate IDs that aren't in our enabled set.
      deliveryProductId: 8,
      // 1 = "Standard" measurement instructions (per OpenAPI examples).
      measurementInstructionType: 1,
      changesInLast4Years: false,
      latitude,
      longitude,
      referenceId: input.dealId,
    });
    realReportId = String(placed.reportId);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "placeOrder" },
      extra: { dealId: input.dealId, orderId: claim.order.id },
    });
    await markFailed(deps.prisma, claim.order.id, "place_order_failed");
    return {
      orderId: claim.order.id,
      reportId: claim.order.reportId,
      status: "FAILED",
      isNew: true,
      reason: "place_order_failed",
    };
  }

  // 6. Update DB row with real ReportId
  await deps.prisma.eagleViewOrder.update({
    where: { id: claim.order.id },
    data: { reportId: realReportId, status: "ORDERED" },
  });

  // 7. Best-effort HubSpot note
  await deps
    .postDealNote(
      input.dealId,
      `<p>EagleView TrueDesign ordered (Report #${realReportId}). Files will land in the design-docs folder when delivery completes.</p>`,
    )
    .catch((err) => {
      console.warn("[eagleview-pipeline] postDealNote failed", err);
    });

  return {
    orderId: claim.order.id,
    reportId: realReportId,
    status: "ORDERED",
    isNew: true,
  };
}

// ============================================================
// File pull
// ============================================================

export async function fetchAndStoreDeliverables(
  deps: PipelineDeps,
  reportId: string | number,
): Promise<FetchDeliverablesResult> {
  const reportIdStr = String(reportId);
  const order = await deps.prisma.eagleViewOrder.findUnique({
    where: { reportId: reportIdStr },
  });
  if (!order) {
    return { status: "FAILED", reason: "order_not_found" };
  }
  if (order.status === "DELIVERED") {
    return { status: "SKIPPED", reason: "already_delivered" };
  }

  // 1. Fetch signed file URLs
  let links: FileLinksResponse;
  try {
    links = await deps.client.getFileLinks(reportIdStr);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "getFileLinks" },
      extra: { reportId: reportIdStr },
    });
    return { status: "FAILED", reason: "get_file_links_failed" };
  }

  if (!links.links || links.links.length === 0) {
    return { status: "FAILED", reason: "no_files_yet" };
  }

  // 2. Resolve Drive folder
  const dealFields = await deps.fetchDealAddress(order.dealId);
  const parentFolderId =
    dealFields?.driveDesignDocumentsFolderId ??
    dealFields?.driveAllDocumentsFolderId ??
    null;

  if (!parentFolderId) {
    return { status: "FAILED", reason: "drive_folder_missing" };
  }

  let driveFolderId: string;
  try {
    driveFolderId = await deps.ensureDriveFolder(
      order.dealId,
      parentFolderId,
      `eagleview-${reportIdStr}`,
    );
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "ensureDriveFolder" },
      extra: { reportId: reportIdStr, dealId: order.dealId },
    });
    return { status: "FAILED", reason: "drive_folder_create_failed" };
  }

  // 3. Download + upload each file. Group by FileType so we can record specific
  //    Drive file IDs on the order row.
  const fileIdByType: Record<string, string> = {};
  const uploadedNames: string[] = [];

  for (const link of links.links) {
    try {
      const bytes = await deps.client.downloadFile(link.link);
      const { mimeType, ext } = inferMimeAndExt(link);
      const filename = sanitizeFilename(`${link.fileType}.${ext}`);
      const uploaded = await deps.uploadToDrive(
        driveFolderId,
        filename,
        bytes,
        mimeType,
      );
      fileIdByType[normalizeFileType(link.fileType)] = uploaded.id;
      uploadedNames.push(uploaded.name);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "eagleview", phase: "downloadAndUpload" },
        extra: { reportId: reportIdStr, fileType: link.fileType },
      });
      // Continue trying other files; partial success is better than no success.
    }
  }

  if (uploadedNames.length === 0) {
    return { status: "FAILED", reason: "all_uploads_failed" };
  }

  // 4. Update order row
  await deps.prisma.eagleViewOrder.update({
    where: { id: order.id },
    data: {
      status: "DELIVERED",
      deliveredAt: new Date(),
      driveFolderId,
      imageDriveFileId: fileIdByType["image"] ?? null,
      layoutJsonDriveFileId: fileIdByType["layout"] ?? null,
      shadeJsonDriveFileId: fileIdByType["shade"] ?? null,
      reportPdfDriveFileId: fileIdByType["report-pdf"] ?? null,
      reportXmlDriveFileId: fileIdByType["report-xml"] ?? null,
    },
  });

  // 5. Best-effort HubSpot note
  await deps
    .postDealNote(
      order.dealId,
      `<p>EagleView files delivered (${uploadedNames.length} files): ${uploadedNames
        .map((n) => `<code>${escapeHtml(n)}</code>`)
        .join(", ")}.</p>`,
    )
    .catch((err) => {
      console.warn("[eagleview-pipeline] delivered-note failed", err);
    });

  return { status: "DELIVERED", driveFolderId };
}

// ============================================================
// Internals
// ============================================================

function formatAddressOneLine(parts: AddressParts): string {
  const segs: string[] = [];
  if (parts.street) {
    segs.push(parts.unit ? `${parts.street} ${parts.unit}` : parts.street);
  }
  if (parts.city) segs.push(parts.city);
  segs.push(`${parts.state} ${parts.zip}`.trim());
  segs.push("United States");
  return segs.filter(Boolean).join(", ");
}

async function failWithoutClaim(
  prisma: Pick<PrismaClient, "eagleViewOrder">,
  input: OrderTrueDesignInput,
  reason: string,
): Promise<OrderTrueDesignResult> {
  // We never made a DB row, so synthesize a result.
  void prisma; // unused — kept for symmetry with helpers that do write.
  return {
    orderId: "",
    reportId: "",
    status: "FAILED",
    isNew: false,
    reason,
  };
}

async function markFailed(
  prisma: Pick<PrismaClient, "eagleViewOrder">,
  orderId: string,
  reason: string,
): Promise<void> {
  await prisma.eagleViewOrder.update({
    where: { id: orderId },
    data: {
      status: "FAILED",
      errorMessage: reason,
    },
  });
}

const FILE_TYPE_NORMALIZATIONS: Record<string, string> = {
  "design-image": "image",
  image: "image",
  aerial: "image",
  "panel-layout": "layout",
  layout: "layout",
  "shade-analysis": "shade",
  shade: "shade",
  "measurement-pdf": "report-pdf",
  "measurement-report": "report-pdf",
  "report-pdf": "report-pdf",
  "measurement-xml": "report-xml",
  "report-xml": "report-xml",
};

function normalizeFileType(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/\s+/g, "-");
  return FILE_TYPE_NORMALIZATIONS[lower] ?? lower;
}

function inferMimeAndExt(link: ReportFileLink): { mimeType: string; ext: string } {
  const lower = link.fileType.toLowerCase();
  if (lower.includes("xml")) return { mimeType: "application/xml", ext: "xml" };
  if (lower.includes("pdf") || lower.includes("report"))
    return { mimeType: "application/pdf", ext: "pdf" };
  if (lower.includes("json") || lower.includes("layout") || lower.includes("shade"))
    return { mimeType: "application/json", ext: "json" };
  if (lower.includes("png")) return { mimeType: "image/png", ext: "png" };
  if (lower.includes("jpg") || lower.includes("jpeg") || lower.includes("image"))
    return { mimeType: "image/jpeg", ext: "jpg" };
  if (lower.includes("zip"))
    return { mimeType: "application/zip", ext: "zip" };
  return { mimeType: "application/octet-stream", ext: "bin" };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 200);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
