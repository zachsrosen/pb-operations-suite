/**
 * Push the remaining 7-9 IPs that have Zoho but no Zuper link.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const ZUPER_CATEGORY_MAP: Record<string, string> = {
  MODULE: "Module", INVERTER: "Inverter", BATTERY: "Battery",
  BATTERY_EXPANSION: "Battery Expansion", EV_CHARGER: "EV Charger",
  RACKING: "Mounting Hardware", ELECTRICAL_BOS: "Electrical Hardwire",
  MONITORING: "Relay Device", RAPID_SHUTDOWN: "Relay Device",
  OPTIMIZER: "Optimizer", GATEWAY: "Relay Device",
  D_AND_R: "D&R", SERVICE: "Service", ADDER_SERVICES: "Service",
  TESLA_SYSTEM_COMPONENTS: "Tesla System Components",
  PROJECT_MILESTONES: "Service",
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { createOrUpdateZuperPart } = await import("../src/lib/zuper-catalog.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // All IPs without Zuper
  const noZuper = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: null },
    select: { id: true, category: true, brand: true, model: true, name: true, sku: true },
  });

  console.log(`IPs without Zuper link: ${noZuper.length}\n`);

  for (const ip of noZuper) {
    const zuperCategory = ZUPER_CATEGORY_MAP[ip.category] || "General";
    const displayName = ip.name || `${ip.brand} ${ip.model}`;

    try {
      const result = await createOrUpdateZuperPart({
        brand: ip.brand,
        model: ip.model,
        name: displayName,
        sku: ip.sku || ip.model,
        category: zuperCategory,
      });

      await prisma.internalProduct.update({
        where: { id: ip.id },
        data: { zuperItemId: result.zuperItemId },
      });

      const verb = result.created ? "CREATED" : "FOUND";
      console.log(`  ✓ ${verb}: ${displayName} → ${result.zuperItemId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ERROR: ${displayName} — ${msg.substring(0, 80)}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Final count
  const remaining = await prisma.internalProduct.count({
    where: { isActive: true, zuperItemId: null },
  });
  console.log(`\nIPs still without Zuper: ${remaining}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
