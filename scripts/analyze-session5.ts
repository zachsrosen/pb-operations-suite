import * as fs from "fs";

interface EquipmentItem {
  name: string;
  sku: string;
  quantity: number;
  rate: number;
}

interface ClassifiedSO {
  so_number: string;
  proj_number: string;
  customer: string;
  warehouse: string;
  date: string;
  total: number;
  equipment_count: number;
  job_type: string;
  has_modules: boolean;
  module_brand: string | null;
  module_model: string | null;
  module_count: number;
  has_pw3: boolean;
  pw3_count: number;
  has_expansion: boolean;
  has_backup_switch: boolean;
  has_racking: boolean;
  racking_type: string;
  inverter_type: string;
  equipment: EquipmentItem[];
}

const dataset: ClassifiedSO[] = JSON.parse(
  fs.readFileSync("/Users/zach/Downloads/SOs/session-5-dataset.json", "utf-8")
);

const lines: string[] = [];
function log(s: string) { lines.push(s); }

log("# Session 5 — BOM SO Analysis (Ops SOs Only)");
log(`\n**Date:** 2026-03-01`);
log(`**Scope:** 5 deals per PB location, construction complete Dec 2025`);
log(`**Total SOs analyzed:** ${dataset.length} (24 target, 1 test deal excluded, 1 SO number malformed)`);
log(`**Note:** This session analyzes ops SOs only — no BOM extraction or auto SO comparison was performed (Zoho token had scope issues during setup, resolved mid-session)`);

// === Deal Summary ===
log("\n## Deal Summary\n");
log("| # | PROJ | Customer | Location | Job Type | Eq Items | Modules | PW3 | Racking | Total |");
log("|---|------|----------|----------|----------|----------|---------|-----|---------|-------|");
dataset.forEach((so, i) => {
  log(`| ${i + 1} | ${so.proj_number} | ${so.customer} | ${so.warehouse} | ${so.job_type} | ${so.equipment_count} | ${so.module_count} | ${so.pw3_count} | ${so.racking_type} | $${so.total.toLocaleString()} |`);
});

// === By Location ===
log("\n## Analysis by Location\n");
const byLoc = Object.groupBy(dataset, (c) => c.warehouse);
for (const [loc, sos] of Object.entries(byLoc)) {
  if (!sos) continue;
  const solarSOs = sos.filter((s) => s.has_modules);
  const battOnly = sos.filter((s) => !s.has_modules && s.has_pw3);
  const avgEq = (sos.reduce((sum, s) => sum + s.equipment_count, 0) / sos.length).toFixed(1);
  const hasRacking = sos.filter((s) => s.has_racking).length;

  log(`### ${loc} (${sos.length} SOs)\n`);
  log(`- **Solar jobs:** ${solarSOs.length}, **Battery-only:** ${battOnly.length}`);
  log(`- **Avg equipment items:** ${avgEq}`);
  log(`- **Racking included:** ${hasRacking}/${sos.length} SOs (${hasRacking > 0 ? sos.filter(s => s.has_racking).map(s => s.racking_type).join(", ") : "none"})`);
  log(`- **Avg total:** $${(sos.reduce((sum, s) => sum + s.total, 0) / sos.length).toFixed(2)}`);
  log("");
}

// === Item Frequency Analysis ===
log("\n## Item Frequency Analysis\n");
log("Which equipment items appear in what % of SOs, by location?\n");

// Build item frequency by location
const allItems = new Map<string, Map<string, number>>();
for (const so of dataset) {
  for (const item of so.equipment) {
    const key = item.sku || item.name;
    if (!allItems.has(key)) allItems.set(key, new Map());
    const locMap = allItems.get(key)!;
    locMap.set(so.warehouse, (locMap.get(so.warehouse) || 0) + 1);
  }
}

// Sort by total frequency
const sortedItems = [...allItems.entries()]
  .map(([sku, locMap]) => {
    const total = [...locMap.values()].reduce((a, b) => a + b, 0);
    return { sku, locMap, total };
  })
  .sort((a, b) => b.total - a.total);

const locations = ["Westminster", "Centennial", "Colorado Springs", "SLO", "Camarillo", "(not set)"];
const locCounts: Record<string, number> = {};
for (const so of dataset) {
  locCounts[so.warehouse] = (locCounts[so.warehouse] || 0) + 1;
}

log("| Item SKU | " + locations.map(l => l.substring(0, 12)).join(" | ") + " | Total |");
log("|----------|" + locations.map(() => "------|").join("") + "-------|");
for (const item of sortedItems.slice(0, 30)) {
  const cols = locations.map((loc) => {
    const count = item.locMap.get(loc) || 0;
    const total = locCounts[loc] || 0;
    return total > 0 ? `${count}/${total}` : "-";
  });
  log(`| ${item.sku.substring(0, 30).padEnd(30)} | ${cols.join(" | ")} | ${item.total} |`);
}

// === Quantity vs Module Count Analysis ===
log("\n## Quantity vs Module Count Analysis\n");
log("For solar jobs with racking (Westminster + Centennial), how do variable-qty items scale with module count?\n");

const solarWithRacking = dataset.filter((s) => s.has_modules && s.has_racking);
if (solarWithRacking.length > 0) {
  const targets = [
    { label: "HUG (2101151)", match: (sku: string) => sku === "2101151" },
    { label: "RD Screws", match: (sku: string) => /HW-RD|2101175/i.test(sku) },
    { label: "Mid Clamps (UFO-CL)", match: (sku: string) => /UFO-CL/i.test(sku) },
    { label: "End Clamps (UFO-END)", match: (sku: string) => /UFO-END/i.test(sku) },
    { label: "T-Bolt (BHW-TB)", match: (sku: string) => /BHW-TB/i.test(sku) },
    { label: "Ground Lug (XR-LUG)", match: (sku: string) => /XR-LUG/i.test(sku) },
    { label: "MCI-2", match: (sku: string) => /MCI|1879359/i.test(sku) },
    { label: "Critter Guard", match: (sku: string) => /S6466|critter/i.test(sku) },
    { label: "SunScreener", match: (sku: string) => /S6438|sunscreen/i.test(sku) },
    { label: "SOLOBOX", match: (sku: string) => /SBOX|solobox/i.test(sku) },
    { label: "Strain Relief", match: (sku: string) => /M3317|strain/i.test(sku) },
    { label: "XR10 Rails", match: (sku: string) => /XR-10-\d+/i.test(sku) },
  ];

  log("| SO | Modules |" + targets.map((t) => ` ${t.label.substring(0, 12)} |`).join(""));
  log("|-----|---------|" + targets.map(() => "------|").join(""));

  for (const so of solarWithRacking) {
    const cols = targets.map((t) => {
      const items = so.equipment.filter((i) => t.match(i.sku || ""));
      const qty = items.reduce((sum, i) => sum + i.quantity, 0);
      return qty > 0 ? String(qty) : "-";
    });
    log(`| ${so.so_number} | ${so.module_count} | ${cols.join(" | ")} |`);
  }

  // Calculate ratios
  log("\n### Quantity Ratios (qty / module_count)\n");
  log("| Item | Min Ratio | Max Ratio | Avg Ratio | Suggested Formula |");
  log("|------|-----------|-----------|-----------|-------------------|");
  for (const t of targets) {
    const ratios: number[] = [];
    for (const so of solarWithRacking) {
      const qty = so.equipment.filter((i) => t.match(i.sku || "")).reduce((sum, i) => sum + i.quantity, 0);
      if (qty > 0 && so.module_count > 0) {
        ratios.push(qty / so.module_count);
      }
    }
    if (ratios.length > 0) {
      const min = Math.min(...ratios).toFixed(2);
      const max = Math.max(...ratios).toFixed(2);
      const avg = (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2);
      log(`| ${t.label} | ${min} | ${max} | ${avg} | ~${avg}x modules |`);
    }
  }
}

// === SLO/CAM Pattern (no racking) ===
log("\n## SLO & Camarillo Pattern (No Racking)\n");
log("Confirming: SLO and CAM SOs contain NO racking items.\n");
const sloCam = dataset.filter((s) => s.warehouse === "SLO" || s.warehouse === "Camarillo");
for (const so of sloCam) {
  const rackItems = so.equipment.filter((i) => /XR-10|XR-100|UFO|2101151|BHW-TB/i.test(i.sku || ""));
  log(`- ${so.so_number} (${so.warehouse}): ${rackItems.length === 0 ? "NO racking" : `HAS racking: ${rackItems.map(i => i.sku).join(", ")}`}`);
}

// === Colorado Springs Pattern ===
log("\n## Colorado Springs Pattern\n");
const coSprings = dataset.filter((s) => s.warehouse === "Colorado Springs");
for (const so of coSprings) {
  const rackItems = so.equipment.filter((i) => /XR-10|XR-100|UFO|2101151|BHW-TB/i.test(i.sku || ""));
  log(`- ${so.so_number} (${so.job_type}, ${so.module_count} modules): ${rackItems.length === 0 ? "NO racking" : `HAS racking: ${rackItems.map(i => i.sku).join(", ")}`} | eq=${so.equipment_count}`);
}
log("\n**Notable:** CO Springs SOs have very low equipment counts (2-8 items). Solar jobs with 18-27 modules have only 2 equipment items — suggesting major equipment is tracked differently (bulk/warehouse stock?) or SOs are incomplete.");

// === Breaker Patterns ===
log("\n## Breaker Patterns\n");
for (const so of dataset) {
  const breakers = so.equipment.filter((i) => /BR2|HOM2|Q2|THQL/i.test(i.sku || ""));
  if (breakers.length > 0) {
    log(`- ${so.so_number} (${so.warehouse}): ${breakers.map(i => `${i.name} [${i.sku}] x${i.quantity}`).join(", ")}`);
  }
}

// === "Unknown" Job Types ===
log("\n## Unclassified SOs\n");
const unknowns = dataset.filter((s) => s.job_type === "unknown");
for (const so of unknowns) {
  log(`### ${so.so_number} — ${so.customer} (${so.warehouse})\n`);
  log(`Equipment (${so.equipment_count} items):`);
  for (const item of so.equipment) {
    log(`  - ${item.name} [${item.sku}] x${item.quantity}`);
  }
  log("");
}

// === Key Findings ===
log("\n## Key Findings\n");
log("### 1. Racking Inclusion by Location (CONFIRMED, n=23)");
log("- **Westminster**: 4/4 solar SOs include racking (XR10)");
log("- **Centennial**: 4/4 SOs include racking (XR10) — all solar");
log("- **SLO**: 0/5 SOs include racking");
log("- **Camarillo**: 0/5 SOs include racking");
log("- **CO Springs**: 0/4 SOs include racking (BUT very low eq counts suggest SOs may be partial)");

log("\n### 2. Equipment Count Disparity by Location");
const westAvg = dataset.filter(s => s.warehouse === "Westminster").reduce((sum, s) => sum + s.equipment_count, 0) / dataset.filter(s => s.warehouse === "Westminster").length;
const centAvg = dataset.filter(s => s.warehouse === "Centennial").reduce((sum, s) => sum + s.equipment_count, 0) / dataset.filter(s => s.warehouse === "Centennial").length;
const sloAvg = dataset.filter(s => s.warehouse === "SLO").reduce((sum, s) => sum + s.equipment_count, 0) / dataset.filter(s => s.warehouse === "SLO").length;
const camAvg = dataset.filter(s => s.warehouse === "Camarillo").reduce((sum, s) => sum + s.equipment_count, 0) / dataset.filter(s => s.warehouse === "Camarillo").length;
log(`- Westminster: avg ${westAvg.toFixed(0)} equipment items`);
log(`- Centennial: avg ${centAvg.toFixed(0)} equipment items`);
log(`- SLO: avg ${sloAvg.toFixed(0)} equipment items`);
log(`- Camarillo: avg ${camAvg.toFixed(0)} equipment items`);
log("- SLO/CAM SOs contain only major equipment (panels, batteries, inverters) — BOS (racking, clamps, screws) is managed separately");

log("\n### 3. SO Number Format Issue");
log("- SO-8593 (Manocchio, Centennial) has SO number `SO_ 8593` with a space — data entry error in Zoho");
log("- This breaks the app's SO lookup which normalizes `SO_` → `SO-` — the space is preserved and causes 'not found'");

log("\n### 4. Job Type Distribution");
const byType = Object.groupBy(dataset, (c) => c.job_type);
for (const [type, sos] of Object.entries(byType)) {
  log(`- **${type}**: ${sos!.length} jobs (${sos!.map(s => s.proj_number).join(", ")})`);
}

// Write to file
fs.writeFileSync("/Users/zach/Downloads/SOs/session-5-analysis.md", lines.join("\n"));
console.log("Analysis written to session-5-analysis.md (" + lines.length + " lines)");
