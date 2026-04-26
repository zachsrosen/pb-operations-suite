/**
 * Execute the action plan from _match-zoho-orphans.ts (scripts/zoho-orphan-matches.json):
 *
 *   LINK_ALL              — both InternalProduct and Zuper exist; just write cross-link IDs
 *   LINK_INT_NEW_ZUPER    — InternalProduct exists; create Zuper Product, link both ways
 *   NEW_INT_LINK_ZUPER    — Zuper exists; create InternalProduct, link both ways
 *   NEW_INT_NEW_ZUPER     — neither exists; create both, link all three
 *
 * Skips HubSpot side entirely — most of these are commodity ELECTRICAL_BOS
 * items that intentionally don't ship to HubSpot (per the M3 audit pattern).
 *
 * Run: node --env-file=.env.local --import tsx scripts/_execute-zoho-orphan-matches.ts [--confirm] [--limit=N] [--action=X]
 *
 * Defaults:
 *   --limit defaults to 5 in dry-run, no limit when --confirm
 *   --action filters to a single action bucket; otherwise processes all
 */
import { prisma, logActivity } from "../src/lib/db";
import { zohoInventory, createOrUpdateZohoItem } from "../src/lib/zoho-inventory";
import { createOrUpdateZuperPart, buildZuperCustomFieldsFromMetadata } from "../src/lib/zuper-catalog";
import { writeCrossLinkIds } from "../src/lib/catalog-cross-link";
import { getZuperCategoryValue } from "../src/lib/catalog-fields";
import { canonicalToken, buildCanonicalKey } from "../src/lib/canonical";
import { EquipmentCategory } from "../src/generated/prisma/enums";

const DRY_RUN = !process.argv.includes("--confirm");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
const ACTION_ARG = process.argv.find((a) => a.startsWith("--action="))?.split("=")[1];
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG) : (DRY_RUN ? 5 : Number.MAX_SAFE_INTEGER);

// Zoho category_name → internal EquipmentCategory enum
const ZOHO_TO_INTERNAL_CATEGORY: Record<string, string> = {
  "Module": "MODULE",
  "Inverter": "INVERTER",
  "Battery": "BATTERY",
  "EV Charger": "EV_CHARGER",
  "Tesla": "TESLA_SYSTEM_COMPONENTS",
  "Non-inventory": "SERVICE",
  "Solar Component": "ELECTRICAL_BOS",  // could be RACKING/MONITORING — default to BOS
  "Electrical Component": "ELECTRICAL_BOS",
  "Breaker": "ELECTRICAL_BOS",
  "Wire": "ELECTRICAL_BOS",
  "PVC": "ELECTRICAL_BOS",
  "Coupling": "ELECTRICAL_BOS",
  "Nipple": "ELECTRICAL_BOS",
  "Bushing": "ELECTRICAL_BOS",
  "Fastener": "ELECTRICAL_BOS",
  "Fuse": "ELECTRICAL_BOS",
  "Locknut": "ELECTRICAL_BOS",
  "Screw": "ELECTRICAL_BOS",
  "Strap": "ELECTRICAL_BOS",
  "Load Center": "ELECTRICAL_BOS",
  "Clamp - Electrical": "ELECTRICAL_BOS",
  "Clamp - Solar": "RACKING",
  "Other": "ELECTRICAL_BOS",
};

interface MatchEntry {
  zohoId: string; zohoName: string; zohoSku: string; zohoCategory: string;
  zohoBrand: string | null; zohoPrice: number | null; zohoUnit: string | null;
  zohoLastMod: string | null; reason: string;
  internalMatch: { id: string; brand: string; model: string; matchedBy: string } | null;
  zuperMatch: { id: string; name: string; matchedBy: string } | null;
  action: "LINK_ALL" | "LINK_INT_NEW_ZUPER" | "NEW_INT_LINK_ZUPER" | "NEW_INT_NEW_ZUPER";
}

function inferInternalCategory(zohoCategory: string): string {
  return ZOHO_TO_INTERNAL_CATEGORY[zohoCategory] || "ELECTRICAL_BOS";
}

function inferBrand(m: MatchEntry): string {
  if (m.zohoBrand && m.zohoBrand.trim()) return m.zohoBrand.trim();
  return "Generic";
}

function inferModel(m: MatchEntry): string {
  // Prefer SKU as the model identifier; fall back to name; cap length
  const candidate = (m.zohoSku || m.zohoName).trim();
  return candidate.slice(0, 200);
}

async function ensureInternalProduct(m: MatchEntry): Promise<string> {
  if (!prisma) throw new Error("prisma");
  if (m.internalMatch) return m.internalMatch.id;
  const category = inferInternalCategory(m.zohoCategory) as keyof typeof EquipmentCategory;
  const brand = inferBrand(m);
  const model = inferModel(m);
  if (DRY_RUN) {
    console.log(`    DRY RUN: would create InternalProduct category=${category} brand="${brand}" model="${model}"`);
    return "DRY_RUN_INTERNAL_ID";
  }
  // Use upsert by (category, brand, model) to be idempotent
  const created = await prisma.internalProduct.upsert({
    where: { category_brand_model: { category, brand, model } },
    update: {
      // Just refresh active flag and zohoItemId/sku/etc on conflict
      isActive: true,
      zohoItemId: m.zohoId,
      ...(m.zohoSku ? { sku: m.zohoSku } : {}),
      ...(m.zohoName && !m.zohoSku ? { description: m.zohoName } : {}),
      ...(m.zohoUnit ? { unitLabel: m.zohoUnit } : {}),
      ...(m.zohoPrice != null ? { sellPrice: m.zohoPrice } : {}),
    },
    create: {
      category,
      brand,
      model,
      sku: m.zohoSku || null,
      description: m.zohoName || null,
      unitLabel: m.zohoUnit || null,
      sellPrice: m.zohoPrice ?? null,
      zohoItemId: m.zohoId,
      isActive: true,
      canonicalBrand: canonicalToken(brand) || null,
      canonicalModel: canonicalToken(model) || null,
      canonicalKey: buildCanonicalKey(category, brand, model),
    },
  });
  return created.id;
}

async function ensureZuperProduct(m: MatchEntry, internalProductId: string): Promise<string | null> {
  if (m.zuperMatch) return m.zuperMatch.id;
  const category = inferInternalCategory(m.zohoCategory);
  const brand = inferBrand(m);
  const model = inferModel(m);
  if (DRY_RUN) {
    console.log(`    DRY RUN: would create Zuper Product brand="${brand}" model="${model}" category=${category}`);
    return "DRY_RUN_ZUPER_ID";
  }
  try {
    const r = await createOrUpdateZuperPart({
      brand,
      model,
      sku: m.zohoSku || null,
      description: m.zohoName || null,
      unitLabel: m.zohoUnit,
      sellPrice: m.zohoPrice ?? null,
      category: getZuperCategoryValue(category),
    });
    return r.zuperItemId;
  } catch (e) {
    console.log(`    ✗ Zuper create failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function linkInternalToExternal(internalProductId: string, zohoItemId: string, zuperItemId: string | null): Promise<void> {
  if (!prisma) throw new Error("prisma");
  if (DRY_RUN) {
    console.log(`    DRY RUN: would set InternalProduct.zohoItemId=${zohoItemId}${zuperItemId ? ` zuperItemId=${zuperItemId}` : ""}`);
    return;
  }
  await prisma.internalProduct.update({
    where: { id: internalProductId },
    data: {
      zohoItemId,
      ...(zuperItemId ? { zuperItemId } : {}),
    },
  });
}

async function processMatch(m: MatchEntry, idx: number, total: number): Promise<{ ok: boolean; warnings: string[] }> {
  console.log(`\n[${idx + 1}/${total}] ${m.action}  ${m.zohoId}  "${m.zohoName.slice(0, 50)}"  sku=${m.zohoSku || "(none)"}`);
  try {
    const internalId = await ensureInternalProduct(m);
    const zuperId = await ensureZuperProduct(m, internalId);
    await linkInternalToExternal(internalId, m.zohoId, zuperId);
    // Cross-link IDs
    const xlink = await writeCrossLinkIds({
      internalProductId: DRY_RUN ? "DRY_RUN" : internalId,
      zohoItemId: m.zohoId,
      zuperItemId: zuperId,
      hubspotProductId: null,  // intentionally not pushing to HubSpot
    });
    if (xlink.warnings.length > 0) {
      for (const w of xlink.warnings) console.log(`    ⚠ ${w}`);
    } else if (!DRY_RUN) {
      console.log(`    ✓ cross-links written (${xlink.attempted.join(",")})`);
    }
    if (!DRY_RUN) {
      await logActivity({
        type: "CATALOG_PRODUCT_CREATED",
        description: `Phase B Zoho-orphan reconciliation: ${m.action} for "${m.zohoName.slice(0, 60)}"`,
        userEmail: "zach@photonbrothers.com",
        userName: "Phase B orphan-reconciliation script",
        entityType: "internal_product",
        entityId: internalId,
        entityName: `${inferBrand(m)} ${inferModel(m)}`,
        metadata: {
          source: "phase_b_zoho_orphan_reconciliation",
          action: m.action,
          zohoId: m.zohoId,
          zohoName: m.zohoName,
          zohoCategory: m.zohoCategory,
          zoho2026Reason: m.reason,
          createdInternal: !m.internalMatch,
          createdZuper: !m.zuperMatch,
        },
        riskLevel: "LOW",
      });
    }
    return { ok: true, warnings: xlink.warnings };
  } catch (e) {
    console.log(`    ✗ FAILED: ${e instanceof Error ? e.message : e}`);
    return { ok: false, warnings: [e instanceof Error ? e.message : String(e)] };
  }
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }
  const fs = await import("fs");
  const data = JSON.parse(fs.readFileSync("scripts/zoho-orphan-matches.json", "utf-8")) as { matches: MatchEntry[] };

  let toProcess = data.matches;
  if (ACTION_ARG) toProcess = toProcess.filter((m) => m.action === ACTION_ARG);
  toProcess = toProcess.slice(0, LIMIT);

  console.log(`${DRY_RUN ? "DRY RUN — pass --confirm to apply" : "APPLYING"}`);
  console.log(`Processing ${toProcess.length} of ${data.matches.length} matches`);
  if (LIMIT < data.matches.length) console.log(`  (limited to first ${LIMIT})`);
  if (ACTION_ARG) console.log(`  (filtered to action=${ACTION_ARG})`);

  let ok = 0, failed = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const r = await processMatch(toProcess[i], i, toProcess.length);
    if (r.ok) ok++; else failed++;
  }
  console.log(`\nDone: ${ok} ok, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
