/**
 * SKU sync test — PROJ-8654 Lingle battery-only BOM
 * Run: npx tsx scripts/test-shadow.ts
 */
import "dotenv/config";
import { syncInternalProducts } from "../src/lib/bom-snapshot";
import type { BomItem } from "../src/lib/bom-snapshot";

// Real BOM extracted from PROJ-8654 Lingle planset (battery-only + expansion)
const bomItems: BomItem[] = [
  // --- PV-4 BOM Table ---
  {
    category: "BATTERY",
    brand: "Tesla",
    model: "1707000-XX-Y",
    description: "TESLA POWERWALL 3, 13.5kWh BATTERY & INVERTER",
    qty: 1,
    unitSpec: 13.5,
    unitLabel: "kWh",
    source: "PV-4",
  },
  {
    category: "BATTERY",
    brand: "Tesla",
    model: "Powerwall 3 Expansion Pack",
    description: "TESLA POWERWALL-3 EXPANSION PACK",
    qty: 1,
    unitSpec: 13.5,
    unitLabel: "kWh",
    source: "PV-4",
  },
  {
    category: "MONITORING",
    brand: "Tesla",
    model: "Backup Gateway 3",
    description: "200A TESLA BACKUP GATEWAY 3, NEMA 3R, UL LISTED, 240VAC",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Eaton",
    model: "DG222URB",
    description: "60A NON-FUSED AC DISCONNECT, 240 VAC",
    qty: 1,
    source: "PV-4",
  },
  // --- PV-4 SLD: Rapid Shutdown Switch (not in BOM table) ---
  {
    category: "RAPID_SHUTDOWN",
    brand: "IMO",
    model: "IMO SI16-PEL64R-2",
    description: "IMO RAPID SHUTDOWN DEVICE, SI16-PEL64R-2",
    qty: 1,
    source: "PV-4",
  },
  // --- PV-4 Conductor Schedule ---
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 6 AWG",
    description: "Tag A: LINE THWN-2, 6 AWG, 2 conductors in 3/4\" EMT",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 6 AWG Neutral",
    description: "Tag A: NEUTRAL THWN-2, 6 AWG, 1 conductor in 3/4\" EMT",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 10 AWG EGC",
    description: "Tag A: EGC THWN-2, 10 AWG, 1 conductor in 3/4\" EMT",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 2/0 AWG",
    description: "Tag B: LINE THWN-2, 2/0 AWG, 2 conductors in 2\" EMT",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 2/0 AWG Neutral",
    description: "Tag B: NEUTRAL THWN-2, 2/0 AWG, 1 conductor in 2\" EMT",
    qty: 1,
    source: "PV-4",
  },
  {
    category: "ELECTRICAL_BOS",
    brand: "Generic",
    model: "THWN-2 6 AWG EGC",
    description: "Tag B: EGC THWN-2, 6 AWG, 1 conductor in 2\" EMT",
    qty: 1,
    source: "PV-4",
  },
];

async function main() {
  const legacy = process.env.CATALOG_SKU_SYNC_LEGACY ?? "false";
  console.log(`\n🔧 CATALOG_SKU_SYNC_LEGACY = ${legacy}`);
  console.log(`📦 PROJ-8654 Lingle — ${bomItems.length} BOM items\n`);

  const result = await syncInternalProducts(bomItems);

  console.log("═══════════════════════════════════════════");
  console.log("  SKU SYNC RESULT");
  console.log("═══════════════════════════════════════════");
  console.log(`  created:      ${result.created}`);
  console.log(`  updated:      ${result.updated}`);
  console.log(`  skipped:      ${result.skipped}`);
  console.log(`  pending:      ${result.pending}`);
  console.log(`  zohoMatched:  ${result.zohoMatched}`);

  if (result.items.length > 0) {
    console.log("");
    console.log("───────────────────────────────────────────");
    console.log("  PER-ITEM MATCHING DETAIL");
    console.log("───────────────────────────────────────────");
    for (const item of result.items) {
      const source = item.matchSource.padEnd(8);
      const action = item.action.padEnd(18);
      const zoho = item.zohoItemName ? ` → ${item.zohoItemName}` : "";
      console.log(`  [${source}] ${action} ${item.brand} ${item.model}${zoho}`);
    }
  }

  console.log("═══════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
