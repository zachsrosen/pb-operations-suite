/**
 * Inspect the 3 test products before deletion.
 * Confirms: (a) they look like test data, (b) what external systems they're linked to.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_inspect-test-products.ts
 */
import { prisma } from "../src/lib/db";

const TEST_IDS = [
  "cmo39tkke000joj8od6j6e42z",
  "cmo39ufkn000uoj8oh475ail7",
  "cmo39vyq2001aoj8osv4z0pxo",
];

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  for (const id of TEST_IDS) {
    const p = await prisma.internalProduct.findUnique({
      where: { id },
      include: {
        moduleSpec: true,
        inverterSpec: true,
        batterySpec: true,
        evChargerSpec: true,
        mountingHardwareSpec: true,
        electricalHardwareSpec: true,
        relayDeviceSpec: true,
        stockLevels: true,
      },
    });
    if (!p) { console.log(`${id}: NOT FOUND\n`); continue; }
    console.log(`── ${id} ──`);
    console.log(`  brand:            "${p.brand}"`);
    console.log(`  model:            "${p.model}"`);
    console.log(`  category:         ${p.category}`);
    console.log(`  description:      ${p.description}`);
    console.log(`  isActive:         ${p.isActive}`);
    console.log(`  hubspotProductId: ${p.hubspotProductId || "(none)"}`);
    console.log(`  zuperItemId:      ${p.zuperItemId || "(none)"}`);
    console.log(`  zohoItemId:       ${p.zohoItemId || "(none)"}`);
    console.log(`  createdAt:        ${p.createdAt.toISOString()}`);
    const stocks = p.stockLevels?.length ?? 0;
    console.log(`  stock entries:    ${stocks}${stocks > 0 ? ` (${p.stockLevels.map((s) => `${s.location}=${s.quantityOnHand}`).join(", ")})` : ""}`);
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
