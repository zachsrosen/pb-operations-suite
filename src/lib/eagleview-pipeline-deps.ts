/**
 * Real-implementation factory for EagleView PipelineDeps.
 *
 * Routes call `defaultPipelineDeps()` to wire the orchestrator against the
 * production HubSpot client, Google Drive helpers, geocoder, and Prisma.
 * Tests bypass this and pass their own mock-shaped deps directly.
 */
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { getEagleViewClient } from "@/lib/eagleview";
import {
  uploadDriveBinaryFile,
  createDriveFolder,
  listDriveSubfolders,
} from "@/lib/drive-plansets";
import { getDealProperties, updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { createDealNote } from "@/lib/hubspot-engagements";
import { geocodeFreeform } from "@/lib/geocode";
import {
  resolveStampEnabled,
  EAGLEVIEW_STAMP_ENABLED_KEY,
} from "@/lib/eagleview-stamp-flag";
import {
  buildEagleViewProps,
  type PipelineDeps,
  type DealAddressFields,
  type EagleViewStampFields,
} from "@/lib/eagleview-pipeline";

// HubSpot deal properties for address. PB uses `address_line_1` / `postal_code`
// (deal-style fields), NOT `address` / `zip` (contact-style). The fallback
// pair lets either set work on this code path.
const DEAL_PROPERTIES = [
  "address_line_1",
  "address_line_2",
  "address",
  "address2",
  "city",
  "state",
  "postal_code",
  "zip",
  "latitude",
  "longitude",
  "design_documents",
  "design_document_folder_id",
  "all_document_parent_folder_id",
];

async function fetchDealAddress(dealId: string): Promise<DealAddressFields | null> {
  const props = await getDealProperties(dealId, DEAL_PROPERTIES);
  if (!props) return null;
  const num = (s: string | null) => {
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  // Prefer deal-style fields (address_line_1, postal_code), fall back to
  // contact-style (address, zip) for compatibility.
  return {
    address: props.address_line_1 ?? props.address ?? "",
    address2: props.address_line_2 ?? props.address2 ?? null,
    city: props.city ?? "",
    state: props.state ?? "",
    zip: props.postal_code ?? props.zip ?? "",
    latitude: num(props.latitude),
    longitude: num(props.longitude),
    driveDesignDocumentsFolderId:
      props.design_document_folder_id ?? props.design_documents ?? null,
    driveAllDocumentsFolderId: props.all_document_parent_folder_id ?? null,
  };
}

async function ensureDriveFolder(
  _dealId: string,
  parentFolderId: string,
  folderName: string,
): Promise<string> {
  const existing = await listDriveSubfolders(parentFolderId).catch(() => []);
  const match = existing.find(
    (f) => f.name.toLowerCase() === folderName.toLowerCase(),
  );
  if (match) return match.id;
  const created = await createDriveFolder(parentFolderId, folderName);
  return created.id;
}

// Forward-stamping toggle: env override OR a 60s-cached SystemConfig DB row.
// The DB row is the prod switch (Vercel's env-var cap blocks the env var there).
let stampFlagCache: { value: boolean; at: number } | null = null;
const STAMP_FLAG_TTL_MS = 60_000;

async function isEagleViewStampEnabled(): Promise<boolean> {
  const envValue = process.env.EAGLEVIEW_HUBSPOT_STAMP_ENABLED;
  if (envValue === "true") return true;
  const now = Date.now();
  if (stampFlagCache && now - stampFlagCache.at < STAMP_FLAG_TTL_MS) {
    return stampFlagCache.value;
  }
  let dbValue: string | null = null;
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: EAGLEVIEW_STAMP_ENABLED_KEY },
    });
    dbValue = row?.value ?? null;
  } catch {
    dbValue = null;
  }
  const value = resolveStampEnabled(envValue, dbValue);
  stampFlagCache = { value, at: now };
  return value;
}

async function stampStatus(
  target: { dealId: string; ticketId: string | null },
  fields: EagleViewStampFields,
): Promise<void> {
  if (!(await isEagleViewStampEnabled())) return;
  try {
    const props = buildEagleViewProps(fields);
    // Ticket branch FIRST so a ticket-origin synthetic dealId ("ticket:<id>")
    // is never passed to updateDealProperty.
    if (target.ticketId) {
      await updateTicketProperties(target.ticketId, props);
    } else {
      await updateDealProperty(target.dealId, props);
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "stampStatus" },
      extra: { target, status: fields.status },
    });
    console.warn("[eagleview-pipeline-deps] stampStatus failed", err);
  }
}

export function defaultPipelineDeps(): PipelineDeps {
  return {
    prisma,
    client: getEagleViewClient(),
    fetchDealAddress,
    geocode: async (address) => {
      const r = await geocodeFreeform(address);
      if (!r) return null;
      return { latitude: r.latitude, longitude: r.longitude };
    },
    ensureDriveFolder,
    uploadToDrive: (parentId, filename, bytes, mimeType) =>
      uploadDriveBinaryFile(parentId, filename, bytes, mimeType),
    postDealNote: createDealNote,
    stampStatus,
  };
}
