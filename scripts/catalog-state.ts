/**
 * Full breakdown of current IP catalog state.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const allIPs = await prisma.internalProduct.findMany({
    select: {
      id: true, category: true, brand: true, model: true, name: true, isActive: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  const active = allIPs.filter(ip => ip.isActive);
  const inactive = allIPs.filter(ip => !ip.isActive);

  console.log("═".repeat(70));
  console.log("PRODUCT CATALOG STATE");
  console.log("═".repeat(70));
  console.log(`\nTotal IPs: ${allIPs.length} (${active.length} active, ${inactive.length} inactive)`);

  // ── Link coverage on ACTIVE IPs ──
  const hasZoho = active.filter(ip => ip.zohoItemId);
  const hasHS = active.filter(ip => ip.hubspotProductId);
  const hasZuper = active.filter(ip => ip.zuperItemId);
  const hasAll3 = active.filter(ip => ip.zohoItemId && ip.hubspotProductId && ip.zuperItemId);
  const hasZohoAndZuper = active.filter(ip => ip.zohoItemId && ip.zuperItemId);
  const hasNone = active.filter(ip => !ip.zohoItemId && !ip.hubspotProductId && !ip.zuperItemId);

  console.log("\n── ACTIVE IP LINK COVERAGE ──");
  console.log(`  Zoho linked:    ${hasZoho.length} / ${active.length} (${pct(hasZoho.length, active.length)})`);
  console.log(`  HubSpot linked: ${hasHS.length} / ${active.length} (${pct(hasHS.length, active.length)})`);
  console.log(`  Zuper linked:   ${hasZuper.length} / ${active.length} (${pct(hasZuper.length, active.length)})`);
  console.log(`  All 3 systems:  ${hasAll3.length} / ${active.length} (${pct(hasAll3.length, active.length)})`);
  console.log(`  Zoho + Zuper:   ${hasZohoAndZuper.length} / ${active.length} (${pct(hasZohoAndZuper.length, active.length)})`);
  console.log(`  Zero links:     ${hasNone.length}`);

  // ── Link combos ──
  const combos = new Map<string, number>();
  for (const ip of active) {
    const parts: string[] = [];
    if (ip.zohoItemId) parts.push("Zoho");
    if (ip.hubspotProductId) parts.push("HS");
    if (ip.zuperItemId) parts.push("Zuper");
    const key = parts.length > 0 ? parts.join("+") : "NONE";
    combos.set(key, (combos.get(key) || 0) + 1);
  }

  console.log("\n── ACTIVE IP LINK COMBINATIONS ──");
  for (const [combo, count] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${combo.padEnd(20)} ${count}`);
  }

  // ── By category ──
  const catCounts = new Map<string, { active: number; inactive: number; all3: number }>();
  for (const ip of allIPs) {
    if (!catCounts.has(ip.category)) catCounts.set(ip.category, { active: 0, inactive: 0, all3: 0 });
    const c = catCounts.get(ip.category)!;
    if (ip.isActive) {
      c.active++;
      if (ip.zohoItemId && ip.hubspotProductId && ip.zuperItemId) c.all3++;
    } else {
      c.inactive++;
    }
  }

  console.log("\n── BY CATEGORY ──");
  console.log(`  ${"Category".padEnd(22)} Active  Inactive  All-3-linked`);
  for (const [cat, c] of [...catCounts.entries()].sort((a, b) => b[1].active - a[1].active)) {
    console.log(`  ${cat.padEnd(22)} ${String(c.active).padStart(4)}    ${String(c.inactive).padStart(4)}      ${String(c.all3).padStart(4)}`);
  }

  // ── By brand (active only) ──
  const brandCounts = new Map<string, number>();
  for (const ip of active) {
    brandCounts.set(ip.brand, (brandCounts.get(ip.brand) || 0) + 1);
  }

  console.log("\n── BY BRAND (active) ──");
  for (const [brand, count] of [...brandCounts.entries()].sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log(`  ${brand.padEnd(22)} ${count}`);
  }

  // ── Inactive IPs that still have links ──
  const inactiveWithLinks = inactive.filter(ip => ip.zohoItemId || ip.hubspotProductId || ip.zuperItemId);
  if (inactiveWithLinks.length > 0) {
    console.log(`\n── INACTIVE IPs WITH LINKS (${inactiveWithLinks.length}) ──`);
    for (const ip of inactiveWithLinks) {
      const display = ip.name || `${ip.brand} ${ip.model}`;
      const links: string[] = [];
      if (ip.zohoItemId) links.push("Zoho");
      if (ip.hubspotProductId) links.push("HS");
      if (ip.zuperItemId) links.push("Zuper");
      console.log(`  [${ip.category}] ${display} — ${links.join("+")}`);
    }
  }

  // ── Active IPs missing Zoho or Zuper ──
  const missingZoho = active.filter(ip => !ip.zohoItemId);
  const missingZuper = active.filter(ip => !ip.zuperItemId);

  if (missingZoho.length > 0) {
    console.log(`\n── ACTIVE IPs MISSING ZOHO (${missingZoho.length}) ──`);
    for (const ip of missingZoho) {
      const display = ip.name || `${ip.brand} ${ip.model}`;
      console.log(`  [${ip.category}] ${display}`);
    }
  }

  if (missingZuper.length > 0) {
    console.log(`\n── ACTIVE IPs MISSING ZUPER (${missingZuper.length}) ──`);
    for (const ip of missingZuper) {
      const display = ip.name || `${ip.brand} ${ip.model}`;
      console.log(`  [${ip.category}] ${display}`);
    }
  }

  await prisma.$disconnect();
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round(n / total * 100)}%` : "0%";
}

main().catch(e => { console.error(e); process.exit(1); });
