/**
 * Audit the 106 InternalProduct rows with brand="Generic". For each row, pull
 * model + description + vendor info + Zoho item details and propose a likely
 * actual manufacturer.
 *
 * Output: scripts/generic-audit.json with proposed re-brands per row, ready
 * for review.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_audit-generic-products.ts
 */
import { prisma } from "../src/lib/db";
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

interface GenericRow {
  id: string;
  brand: string;
  model: string;
  category: string;
  description: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  hubspotProductId: string | null;
  zohoItemId: string | null;
  zuperItemId: string | null;
  sku: string | null;
}

interface AuditEntry {
  id: string;
  category: string;
  model: string;
  description: string | null;
  vendorName: string | null;
  zohoBrand: string | null;
  zohoManufacturer: string | null;
  zohoCategoryName: string | null;
  hubspotManufacturer: string | null;
  proposedBrand: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
}

function inferBrandFromModel(model: string): { brand: string; confidence: "high" | "medium" | "low"; rationale: string } | null {
  const m = model.toUpperCase().trim();
  // Common solar manufacturer prefixes & patterns
  const rules: Array<{ pattern: RegExp; brand: string; confidence: "high" | "medium" | "low"; rationale: string }> = [
    { pattern: /^IQ\d|^ENPHASE|^ENP[ -]|^Q[ -]CONN|^Q-CONN|^X-IQ-AM/i, brand: "Enphase", confidence: "high", rationale: "Enphase IQ/Q-series part" },
    { pattern: /^MS-IQ|^MS\d/, brand: "Enphase", confidence: "medium", rationale: "Enphase MS pattern" },
    { pattern: /^IRONRIDGE|^XR\d|^FLASH-?FOOT|^GROUND-?MOUNT|^UFO/i, brand: "IronRidge", confidence: "high", rationale: "IronRidge XR/UFO pattern" },
    { pattern: /^UNIRAC|^SM[ -]?TILE|^SOLAR-?MOUNT|^SOLARMOUNT/i, brand: "Unirac", confidence: "high", rationale: "Unirac SolarMount pattern" },
    { pattern: /^TESLA|^POWERWALL|^GATEWAY|^TWC|^MEGAPACK|^BACKUP-SWITCH/i, brand: "Tesla", confidence: "high", rationale: "Tesla product" },
    { pattern: /^SE\d|^SOLAREDGE|^OPTM|^P\d{3,4}|^P-?5\d\d|^P-?7\d\d/i, brand: "SolarEdge", confidence: "high", rationale: "SolarEdge inverter/optimizer pattern" },
    { pattern: /^SQD|^SQ-?D|^Q[OB]\d/i, brand: "Square D", confidence: "high", rationale: "Square D breaker/panel pattern" },
    { pattern: /^EATON|^BR\d|^CH\d|^BAB\d/i, brand: "Eaton", confidence: "medium", rationale: "Eaton BR/CH breaker pattern" },
    { pattern: /^CUTLER/i, brand: "Cutler-Hammer", confidence: "high", rationale: "Cutler-Hammer marker" },
    { pattern: /^SIEMENS|^MP\d|^Q[CT]\d/i, brand: "Siemens", confidence: "medium", rationale: "Siemens MP/QT pattern" },
    { pattern: /^GE-?\b|^THQB|^THQL/i, brand: "GE", confidence: "medium", rationale: "GE THQB/THQL breaker pattern" },
    { pattern: /^MILBANK/i, brand: "Milbank", confidence: "high", rationale: "Milbank product" },
    { pattern: /^EZ-?SOLAR|^EZ\b/i, brand: "EZ Solar", confidence: "high", rationale: "EZ Solar product" },
    { pattern: /^ECOLIBRIUM|^ECO[ -]/i, brand: "Ecolibrium Solar", confidence: "high", rationale: "Ecolibrium Solar product" },
    { pattern: /^IMO|^FIREFLY/i, brand: "IMO", confidence: "high", rationale: "IMO Firefly/disconnect" },
    { pattern: /^S-?5/, brand: "S-5!", confidence: "high", rationale: "S-5! mount" },
    { pattern: /^HEYCO/i, brand: "Heyco", confidence: "high", rationale: "Heyco product" },
    { pattern: /^ABB|^WBS|^OT/i, brand: "ABB", confidence: "medium", rationale: "ABB OT-series pattern" },
    { pattern: /^SOLIS|^S5|^S6/, brand: "Solis", confidence: "medium", rationale: "Solis inverter pattern" },
    { pattern: /^QUICKBOLT|^QB\d/i, brand: "QuickBolt", confidence: "high", rationale: "QuickBolt product" },
    { pattern: /^ROOFTECH/i, brand: "Rooftech", confidence: "high", rationale: "Rooftech product" },
    { pattern: /^ARLINGTON|^DBR|^SCB/i, brand: "Arlington", confidence: "medium", rationale: "Arlington electrical box pattern" },
    { pattern: /^POLARIS|^IPL/i, brand: "Polaris", confidence: "medium", rationale: "Polaris IPL connector" },
    { pattern: /^BUSSMAN|^BUSS|^FRN-?R|^KTK/i, brand: "bussman", confidence: "medium", rationale: "Bussmann fuse pattern" },
    { pattern: /^XCEL/i, brand: "Xcel Energy", confidence: "high", rationale: "Xcel Energy" },
    { pattern: /^SVC/i, brand: "SVC", confidence: "high", rationale: "SVC product" },
    { pattern: /^PEGASUS|^PEG/i, brand: "Pegasus", confidence: "medium", rationale: "Pegasus product" },
    { pattern: /^ALPINE/i, brand: "Alpine", confidence: "high", rationale: "Alpine product" },
    { pattern: /^MIDWEST/i, brand: "Midwest", confidence: "high", rationale: "Midwest product" },
    { pattern: /^BUCHANAN/i, brand: "Buchanan", confidence: "high", rationale: "Buchanan product" },
    { pattern: /^SYSTEM[ -]?SENSOR/i, brand: "System Sensor", confidence: "high", rationale: "System Sensor product" },
    { pattern: /^QCELL|^Q-CELL|^Q\.PEAK/i, brand: "QCell", confidence: "high", rationale: "QCell module" },
    { pattern: /^AP-?SMART/i, brand: "AP Smart", confidence: "high", rationale: "AP Smart product" },
    { pattern: /^SEG-?SOLAR|^SEG/i, brand: "SEG Solar", confidence: "medium", rationale: "SEG Solar pattern" },
    { pattern: /^HYUNDAI/i, brand: "Hyundai", confidence: "high", rationale: "Hyundai module" },
    { pattern: /^REC[ -]/i, brand: "REC", confidence: "high", rationale: "REC module" },
    { pattern: /^LG[ -]/i, brand: "LG", confidence: "high", rationale: "LG product" },
    { pattern: /^SILFAB/i, brand: "Silfab", confidence: "high", rationale: "Silfab module" },
    { pattern: /^HANWHA/i, brand: "Hanwha", confidence: "high", rationale: "Hanwha module" },
  ];
  for (const r of rules) {
    if (r.pattern.test(m)) return { brand: r.brand, confidence: r.confidence, rationale: r.rationale };
  }
  return null;
}

async function fetchHubSpotManufacturer(id: string): Promise<string | null> {
  if (!HUBSPOT_TOKEN) return null;
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${id}?properties=manufacturer,name`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.properties?.manufacturer || null;
}

async function fetchZohoBrand(id: string): Promise<{ brand: string | null; manufacturer: string | null; categoryName: string | null }> {
  try {
    const item = await zohoInventory.getItemById(id);
    return {
      brand: (item as Record<string, string | undefined> | null)?.brand || null,
      manufacturer: (item as Record<string, string | undefined> | null)?.manufacturer || null,
      categoryName: (item as Record<string, string | undefined> | null)?.category_name || null,
    };
  } catch {
    return { brand: null, manufacturer: null, categoryName: null };
  }
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  const rows: GenericRow[] = await prisma.internalProduct.findMany({
    where: { brand: "Generic", isActive: true },
    select: {
      id: true, brand: true, model: true, category: true, description: true,
      vendorName: true, vendorPartNumber: true,
      hubspotProductId: true, zohoItemId: true, zuperItemId: true, sku: true,
    },
  });

  console.log(`Found ${rows.length} Generic products. Auditing...\n`);

  const audits: AuditEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write(`\r  [${i + 1}/${rows.length}] ${row.id.slice(0, 12)}...`);

    const inferred = inferBrandFromModel(row.model);
    const zohoInfo = row.zohoItemId
      ? await fetchZohoBrand(row.zohoItemId)
      : { brand: null, manufacturer: null, categoryName: null };
    const hsManufacturer = row.hubspotProductId ? await fetchHubSpotManufacturer(row.hubspotProductId) : null;

    // Pick best signal: HubSpot manufacturer (if not "Generic"), then Zoho brand/manufacturer, then model inference
    let proposed = "Generic";
    let confidence: "high" | "medium" | "low" = "low";
    let rationale = "no signal — default to Generic";

    if (hsManufacturer && hsManufacturer.toLowerCase() !== "generic") {
      proposed = hsManufacturer;
      confidence = "high";
      rationale = `HubSpot manufacturer is "${hsManufacturer}"`;
    } else if (zohoInfo.brand && zohoInfo.brand.toLowerCase() !== "generic") {
      proposed = zohoInfo.brand;
      confidence = "high";
      rationale = `Zoho brand is "${zohoInfo.brand}"`;
    } else if (zohoInfo.manufacturer && zohoInfo.manufacturer.toLowerCase() !== "generic") {
      proposed = zohoInfo.manufacturer;
      confidence = "high";
      rationale = `Zoho manufacturer is "${zohoInfo.manufacturer}"`;
    } else if (inferred) {
      proposed = inferred.brand;
      confidence = inferred.confidence;
      rationale = `model pattern: ${inferred.rationale}`;
    }

    audits.push({
      id: row.id,
      category: row.category,
      model: row.model,
      description: row.description,
      vendorName: row.vendorName,
      zohoBrand: zohoInfo.brand,
      zohoManufacturer: zohoInfo.manufacturer,
      zohoCategoryName: zohoInfo.categoryName,
      hubspotManufacturer: hsManufacturer,
      proposedBrand: proposed,
      confidence,
      rationale,
    });
  }
  console.log(`\n\nDone auditing ${audits.length} rows.\n`);

  // Summary
  const byBrand = new Map<string, number>();
  const byConf = new Map<string, number>();
  for (const a of audits) {
    byBrand.set(a.proposedBrand, (byBrand.get(a.proposedBrand) || 0) + 1);
    byConf.set(a.confidence, (byConf.get(a.confidence) || 0) + 1);
  }
  console.log("─".repeat(70));
  console.log("PROPOSED REBRANDS (count)");
  console.log("─".repeat(70));
  const sorted = [...byBrand.entries()].sort((a, b) => b[1] - a[1]);
  for (const [brand, n] of sorted) {
    const marker = brand === "Generic" ? "⚠ keep Generic" : "→";
    console.log(`  ${marker} ${brand.padEnd(28)} ${n} rows`);
  }
  console.log();
  console.log(`Confidence breakdown:`);
  for (const [c, n] of byConf) console.log(`  ${c.padEnd(10)} ${n} rows`);

  const fs = await import("fs");
  fs.writeFileSync("scripts/generic-audit.json", JSON.stringify({
    audited_at: new Date().toISOString(),
    total: audits.length,
    summary_by_brand: Object.fromEntries(sorted),
    summary_by_confidence: Object.fromEntries(byConf),
    rows: audits,
  }, null, 2));
  console.log(`\nWrote scripts/generic-audit.json (review before running rebrand script)`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
