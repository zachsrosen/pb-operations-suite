/**
 * Backfill "HubSpot Deal Record ID" custom field on existing Zoho Sales Orders.
 *
 * Finds all BOM snapshots that have both a dealId and zohoSoId, then patches
 * the Zoho SO custom field so every pipeline-created SO links back to its deal.
 *
 * Usage:
 *   npx tsx scripts/backfill-so-deal-ids.ts           # dry-run
 *   npx tsx scripts/backfill-so-deal-ids.ts --apply   # actually patch Zoho
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const applyMode = process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Zoho auth (minimal — just what we need for this script)
// ---------------------------------------------------------------------------

const ZOHO_CLIENT_ID = process.env.ZOHO_INVENTORY_CLIENT_ID!;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_INVENTORY_CLIENT_SECRET!;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_INVENTORY_REFRESH_TOKEN?.trim()!;
const ZOHO_ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID?.trim()!;

async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Token error: ${data.error ?? "unknown"}`);
  return data.access_token;
}

async function patchSoCustomField(
  token: string,
  zohoSoId: string,
  dealId: string,
): Promise<{ ok: boolean; error?: string; deleted?: boolean }> {
  const url = `https://www.zohoapis.com/inventory/v1/salesorders/${zohoSoId}?organization_id=${ZOHO_ORG_ID}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      custom_fields: [{ label: "HubSpot Deal Record ID", value: dealId }],
    }),
  });
  const data = (await res.json()) as { code?: number; message?: string };
  if (data.code !== 0) {
    const deleted = data.message?.includes("does not exist");
    return { ok: false, error: data.message ?? `status ${res.status}`, deleted };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${applyMode ? "APPLY" : "DRY-RUN"}\n`);

  // Find all snapshots that have a Zoho SO linked
  const snapshots = await prisma.projectBomSnapshot.findMany({
    where: {
      zohoSoId: { not: null },
    },
    select: {
      id: true,
      dealId: true,
      dealName: true,
      zohoSoId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${snapshots.length} snapshots with Zoho SO IDs\n`);

  if (snapshots.length === 0) return;

  let token: string | null = null;
  if (applyMode) {
    token = await getAccessToken();
    console.log("Zoho token acquired\n");
  }

  let patched = 0;
  let skipped = 0;
  let failed = 0;

  for (const snap of snapshots) {
    const label = `${snap.dealName} → ${snap.zohoSoId}`;

    if (!snap.dealId) {
      console.log(`  SKIP (no dealId): ${label}`);
      skipped++;
      continue;
    }

    console.log(`  PATCH: ${label} (dealId=${snap.dealId})`);

    if (applyMode && token) {
      const result = await patchSoCustomField(token, snap.zohoSoId!, snap.dealId);
      if (result.ok) {
        patched++;
      } else if (result.deleted) {
        console.log(`    GONE (SO deleted from Zoho)`);
        skipped++;
      } else {
        console.log(`    ERROR: ${result.error}`);
        failed++;
      }
      // Rate limit: Zoho allows ~100 req/min for Inventory API
      await new Promise((r) => setTimeout(r, 700));
    } else {
      patched++;
    }
  }

  console.log(`\nDone: ${patched} patched, ${skipped} skipped, ${failed} failed`);
  if (!applyMode) {
    console.log("Run with --apply to actually update Zoho.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
