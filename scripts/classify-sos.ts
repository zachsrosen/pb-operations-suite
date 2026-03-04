import * as fs from "fs";

interface EquipmentItem {
  name: string;
  sku: string;
  quantity: number;
  rate: number;
  amount?: number;
}

interface SalesOrder {
  salesorder_number: string;
  reference_number: string;
  date: string;
  status: string;
  customer_name: string;
  total: number;
  delivery_method: string;
  notes: string;
  line_item_count: number;
  equipment_count: number;
  line_items: Array<EquipmentItem & { description?: string }>;
  equipment_items: EquipmentItem[];
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

const data: SalesOrder[] = JSON.parse(
  fs.readFileSync("/Users/zach/Downloads/SOs/session-5-ops-sos-raw.json", "utf-8")
);

const locationMap: Record<string, string> = {
  "Photon Brothers Westminster": "Westminster",
  "Photon Brothers Centennial": "Centennial",
  "Photon Brothers Colorado Springs": "Colorado Springs",
  "Photon Brother SLO": "SLO",
  "Photon Brother CAM": "Camarillo",
};

const classified: ClassifiedSO[] = [];

for (const so of data) {
  const eq = so.equipment_items || [];

  const modules = eq.filter((i) =>
    /SEG|HYU|Silfab|Q\.PEAK|Lightspeed|440W|430W|485W/i.test(i.name + " " + (i.sku || ""))
  );
  const hasModules = modules.length > 0;
  const moduleCount = modules.reduce((sum, m) => sum + m.quantity, 0);

  let moduleBrand: string | null = null;
  let moduleModel: string | null = null;
  if (hasModules) {
    const m = modules[0];
    if (/SEG/i.test(m.sku || m.name)) moduleBrand = "SEG Solar";
    else if (/HYU/i.test(m.sku || m.name)) moduleBrand = "Hyundai";
    else if (/Silfab/i.test(m.name)) moduleBrand = "Silfab";
    else if (/Lightspeed/i.test(m.name)) moduleBrand = "Lightspeed";
    moduleModel = m.name;
  }

  const pw3Items = eq.filter((i) => (i.sku || "").includes("1707000-21"));
  const hasPW3 = pw3Items.length > 0;
  const pw3Count = pw3Items.reduce((sum, i) => sum + i.quantity, 0);

  const hasExpansion = eq.some((i) => (i.sku || "").includes("1807000-20"));
  const hasBackupSwitch = eq.some((i) => (i.sku || "").includes("1624171"));

  const rackingItems = eq.filter((i) => /XR-10|XR-100|UFO-CL|UFO-END|2101151/i.test(i.sku || ""));
  const hasRacking = rackingItems.length > 0;
  let rackingType = "none";
  if (rackingItems.some((i) => /XR-10/i.test(i.sku || ""))) rackingType = "XR10";
  else if (rackingItems.some((i) => /XR-100/i.test(i.sku || ""))) rackingType = "XR100";

  let inverterType = "unknown";
  if (eq.some((i) => /Tesla Solar Inverter/i.test(i.name))) inverterType = "tesla_si";
  else if (eq.some((i) => /IQ8/i.test(i.name) || /Enphase/i.test(i.name))) inverterType = "enphase";
  if (hasPW3 && !hasModules) inverterType = "tesla_pw3";

  let jobType = "unknown";
  if (hasModules && hasPW3) jobType = hasExpansion ? "solar_battery_expansion" : "solar_battery";
  else if (hasModules && !hasPW3) jobType = "solar_only";
  else if (!hasModules && hasPW3) {
    if (hasExpansion) jobType = "battery_expansion";
    else if (hasBackupSwitch) jobType = "battery_backup";
    else jobType = "battery_only";
  }

  const proj = so.reference_number?.match(/PROJ-\d+/)?.[0] || so.salesorder_number.replace("SO-", "PROJ-");

  classified.push({
    so_number: so.salesorder_number,
    proj_number: proj,
    customer: so.customer_name,
    warehouse: locationMap[so.delivery_method] || so.delivery_method || "(not set)",
    date: so.date,
    total: so.total,
    equipment_count: eq.length,
    job_type: jobType,
    has_modules: hasModules,
    module_brand: moduleBrand,
    module_model: moduleModel,
    module_count: moduleCount,
    has_pw3: hasPW3,
    pw3_count: pw3Count,
    has_expansion: hasExpansion,
    has_backup_switch: hasBackupSwitch,
    has_racking: hasRacking,
    racking_type: rackingType,
    inverter_type: inverterType,
    equipment: eq,
  });
}

// Write classified dataset
fs.writeFileSync(
  "/Users/zach/Downloads/SOs/session-5-dataset.json",
  JSON.stringify(classified, null, 2)
);

// Print summary
console.log("=== Session 5 Classification Summary ===\n");
console.log(`Total SOs: ${classified.length}\n`);

// By location
const byLocation = Object.groupBy(classified, (c) => c.warehouse);
for (const [loc, sos] of Object.entries(byLocation)) {
  console.log(`\n--- ${loc} (${sos!.length} SOs) ---`);
  for (const so of sos!) {
    console.log(
      `  ${so.so_number} | ${so.customer.padEnd(25)} | ${so.job_type.padEnd(25)} | eq=${String(so.equipment_count).padStart(2)} | modules=${String(so.module_count).padStart(2)} | pw3=${so.pw3_count} | rack=${so.has_racking ? so.racking_type : "none"}`
    );
  }
}

// By job type
console.log("\n\n=== By Job Type ===");
const byType = Object.groupBy(classified, (c) => c.job_type);
for (const [type, sos] of Object.entries(byType)) {
  console.log(`  ${type}: ${sos!.length} jobs`);
}

// Per-job artifacts
const sosDir = "/Users/zach/Downloads/SOs";
for (const so of classified) {
  const raw = data.find((d) => d.salesorder_number === so.so_number)!;
  const customer = so.customer.replace(/[^a-zA-Z0-9-]/g, "");
  const dir = `${sosDir}/${so.proj_number}-${customer}`;
  fs.mkdirSync(dir, { recursive: true });

  // ops-so-data.md
  const lines: string[] = [
    `# ${so.proj_number} ${so.customer} — Ops SO Data (from Zoho API)\n`,
    `## Job Summary`,
    `- **SO Number:** ${so.so_number}`,
    `- **Customer:** ${so.customer}`,
    `- **Reference:** ${raw.reference_number}`,
    `- **Warehouse:** ${so.warehouse}`,
    `- **Total:** $${so.total.toLocaleString()}`,
    `- **Equipment Items:** ${so.equipment_count}`,
    `- **Job Type:** ${so.job_type}`,
    `- **Date:** ${so.date}`,
    `- **Status:** ${raw.status}`,
    ``,
    `## Equipment Items\n`,
    `| # | Item | SKU | Qty | Rate |`,
    `|---|------|-----|-----|------|`,
  ];
  so.equipment.forEach((item, i) => {
    lines.push(`| ${i + 1} | ${item.name} | ${item.sku} | ${item.quantity} | $${item.rate} |`);
  });
  lines.push("", "## Key Observations");
  if (so.has_modules) lines.push(`- ${so.module_count}x ${so.module_brand} modules`);
  if (so.has_pw3) lines.push(`- ${so.pw3_count}x Powerwall 3`);
  if (so.has_expansion) lines.push("- Has Expansion Kit");
  if (so.has_backup_switch) lines.push("- Has Backup Switch");
  if (so.has_racking) lines.push(`- Racking: ${so.racking_type}`);
  lines.push(`- Inverter: ${so.inverter_type}`);

  fs.writeFileSync(`${dir}/ops-so-data.md`, lines.join("\n"));
}

console.log(`\nWrote ${classified.length} per-job artifact directories`);
console.log("Dataset saved to session-5-dataset.json");
