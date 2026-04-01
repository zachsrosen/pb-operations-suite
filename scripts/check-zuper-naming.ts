import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Load IPs that have Zuper links
  const ipsWithZuper = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null } },
    select: { id: true, category: true, brand: true, model: true, name: true, zuperItemId: true, createdAt: true },
  });

  // Load all Zuper products
  const zuperMap = new Map<string, { name: string }>();
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as Record<string, unknown>;
    const batch = (d.data || []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    for (const zp of batch) {
      zuperMap.set(String(zp.product_uid), { name: String(zp.product_name) });
    }
    if (batch.length < 100) break;
    page++;
  }

  // Check: for IPs created today (the ones from our sync), what did the Zuper product get named?
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const createdToday = ipsWithZuper.filter(ip => new Date(ip.createdAt) >= today);
  const createdBefore = ipsWithZuper.filter(ip => new Date(ip.createdAt) < today);

  console.log(`IPs with Zuper link: ${ipsWithZuper.length}`);
  console.log(`Created today: ${createdToday.length}`);
  console.log(`Created before today: ${createdBefore.length}`);

  // Show today's IPs and their Zuper names
  console.log(`\n${"=".repeat(70)}`);
  console.log(`IPs CREATED TODAY → Zuper product names (${createdToday.length})`);
  console.log("=".repeat(70));
  
  let uglyCount = 0;
  for (const ip of createdToday.sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand))) {
    const zuper = zuperMap.get(ip.zuperItemId!);
    const zuperName = zuper?.name || "NOT FOUND";
    const ipDisplay = ip.name || `${ip.brand} ${ip.model}`;
    
    // Check if the Zuper name matches what we'd generate
    const isUgly = zuperName === zuperName.toUpperCase() && zuperName.length > 10;
    const hasAllCaps = /[A-Z]{4,}/.test(zuperName) && !/\b(SMA|REC|USA|BOS|PVC|NMD|AWG|UF-B|SER|MC4|EMT|ENT|PV|DC|AC)\b/.test(zuperName);
    
    if (isUgly || hasAllCaps) uglyCount++;
    
    const marker = (isUgly || hasAllCaps) ? "⚠" : "✓";
    console.log(`${marker} [${ip.category}] IP: "${ipDisplay}"`);
    console.log(`  Zuper: "${zuperName}"`);
    if (ipDisplay !== zuperName) console.log(`  (names differ)`);
    console.log();
  }
  console.log(`Ugly Zuper names from today: ${uglyCount} of ${createdToday.length}`);

  // Quick summary of ALL Zuper-linked IPs with naming mismatches
  console.log(`\n${"=".repeat(70)}`);
  console.log(`ALL IPs where Zuper name differs from IP display name`);
  console.log("=".repeat(70));
  
  let mismatchCount = 0;
  for (const ip of ipsWithZuper.sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand))) {
    const zuper = zuperMap.get(ip.zuperItemId!);
    if (!zuper) continue;
    const ipDisplay = ip.name || `${ip.brand} ${ip.model}`;
    if (zuper.name !== ipDisplay) {
      mismatchCount++;
      console.log(`  IP: "${ipDisplay}" → Zuper: "${zuper.name}"`);
    }
  }
  console.log(`\nMismatches: ${mismatchCount} of ${ipsWithZuper.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
