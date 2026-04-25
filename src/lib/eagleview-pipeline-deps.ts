/**
 * Real-implementation factory for EagleView PipelineDeps.
 *
 * Routes call `defaultPipelineDeps()` to wire the orchestrator against the
 * production HubSpot client, Google Drive helpers, geocoder, and Prisma.
 * Tests bypass this and pass their own mock-shaped deps directly.
 */
import { prisma } from "@/lib/db";
import { getEagleViewClient } from "@/lib/eagleview";
import {
  uploadDriveBinaryFile,
  createDriveFolder,
  listDriveSubfolders,
} from "@/lib/drive-plansets";
import { getDealProperties } from "@/lib/hubspot";
import { createDealNote } from "@/lib/hubspot-engagements";
import { geocodeFreeform } from "@/lib/geocode";
import type {
  PipelineDeps,
  DealAddressFields,
} from "@/lib/eagleview-pipeline";

const DEAL_PROPERTIES = [
  "address",
  "address2",
  "city",
  "state",
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
  return {
    address: props.address ?? "",
    address2: props.address2 ?? null,
    city: props.city ?? "",
    state: props.state ?? "",
    zip: props.zip ?? "",
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
  };
}
