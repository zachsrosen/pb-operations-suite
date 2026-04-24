/**
 * Backfill Zoho Inventory item images from PendingCatalogPush.metadata._photoUrl.
 *
 * Context: the "push product photo to Zoho" code in executeCatalogPushApproval
 * (src/lib/catalog-push-approve.ts) didn't exist until PR #396. Products
 * approved before then had their photo uploaded to Vercel Blob and the URL
 * stored in PendingCatalogPush.metadata._photoUrl, but nothing ever pushed the
 * bytes to Zoho. This script walks those rows and catches them up.
 *
 * Idempotent: Zoho's POST /items/{item_id}/image replaces the existing image,
 * so re-running this script is safe.
 *
 * Usage:
 *   npx tsx scripts/backfill-zoho-product-photos.ts            # dry run (default)
 *   npx tsx scripts/backfill-zoho-product-photos.ts --apply    # actually push
 */

import dotenv from "dotenv";
// Load .env.local first (overrides), then .env for any missing keys.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// NOTE: zoho-inventory.ts creates a module-level singleton that reads env at
// import time, and @vercel/blob also reads BLOB_READ_WRITE_TOKEN eagerly.
// Both imports MUST happen AFTER dotenv.config(), so use dynamic import.

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");
const DELAY_MS = 250; // gentle spacing between Zoho calls

interface Row {
  id: string;
  brand: string;
  model: string;
  zohoItemId: string;
  photoUrl: string;
  createdAt: Date;
}

/**
 * Parse the blob pathname out of the stored photoUrl. Mirrors
 * extractBlobPathname in src/lib/catalog-push-approve.ts (not exported there).
 */
function extractBlobPathname(photoUrl: string): string | null {
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/api/catalog/photo")) {
    try {
      const parsed = new URL(trimmed, "http://local");
      const path = parsed.searchParams.get("path");
      return path && path.startsWith("catalog-photos/") ? path : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("http")) {
    try {
      const parsed = new URL(trimmed);
      const path = parsed.pathname.replace(/^\//, "");
      return path.startsWith("catalog-photos/") ? path : null;
    } catch {
      return null;
    }
  }
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

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log("");

  // Import after dotenv so both libs see the env vars.
  const { get: getBlob } = await import("@vercel/blob");
  const { uploadZohoItemImage } = await import("../src/lib/zoho-inventory.js");

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      id,
      brand,
      model,
      "zohoItemId",
      metadata->>'_photoUrl' AS "photoUrl",
      "createdAt"
    FROM "PendingCatalogPush"
    WHERE status = 'APPROVED'
      AND "zohoItemId" IS NOT NULL
      AND metadata->>'_photoUrl' IS NOT NULL
      AND metadata->>'_photoUrl' <> ''
    ORDER BY "createdAt" ASC
  `);

  console.log(`Found ${rows.length} approved push(es) with a photo to backfill.\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `${row.brand} ${row.model}`.padEnd(40);
    const pathname = extractBlobPathname(row.photoUrl);
    if (!pathname) {
      console.log(`  SKIP  ${label}  photoUrl not recognized: ${row.photoUrl}`);
      skipped += 1;
      continue;
    }

    try {
      const blobResult = await getBlob(pathname, { access: "private" });
      if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
        console.log(`  SKIP  ${label}  blob not found at ${pathname}`);
        skipped += 1;
        continue;
      }
      const bytes = await streamToUint8Array(blobResult.stream);
      const contentType = blobResult.blob?.contentType || "image/png";
      const fileName = pathname.split("/").pop() || "photo";

      if (!APPLY) {
        console.log(
          `  DRY   ${label}  zoho=${row.zohoItemId}  ${fileName} (${bytes.byteLength} bytes, ${contentType})`,
        );
        ok += 1;
        continue;
      }

      const result = await uploadZohoItemImage(row.zohoItemId, bytes, fileName, contentType);
      if (result.status === "uploaded") {
        console.log(
          `  OK    ${label}  zoho=${row.zohoItemId}  ${result.imageName || fileName} (${bytes.byteLength} bytes)`,
        );
        ok += 1;
      } else {
        console.log(`  FAIL  ${label}  ${result.message}`);
        failed += 1;
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${label}  ${msg}`);
      failed += 1;
    }
  }

  console.log("");
  console.log(`Done. ok=${ok}  skipped=${skipped}  failed=${failed}  mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  if (!APPLY) {
    console.log("(Re-run with --apply to push to Zoho.)");
  }
}

main()
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
