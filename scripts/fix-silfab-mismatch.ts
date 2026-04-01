import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // The correct Zuper product (has HS ID 2668855146 matching the IP)
  const CORRECT_ZUPER_UID = "047545eb-f346-4e3e-987b-d0e4736a4fc5";
  // The wrong one our sync created (no HS ID)
  const WRONG_ZUPER_UID = "14702e40-f399-47a8-ac41-5fdc9db3c71c";

  const ip = await prisma.internalProduct.findFirst({
    where: { brand: "Silfab", model: "SIL-400 HC+", isActive: true },
  });

  if (!ip) {
    console.log("ERROR: Silfab SIL-400 HC+ IP not found");
    return;
  }

  console.log(`Before: zuperItemId = ${ip.zuperItemId}`);

  if (ip.zuperItemId === WRONG_ZUPER_UID) {
    await prisma.internalProduct.update({
      where: { id: ip.id },
      data: { zuperItemId: CORRECT_ZUPER_UID },
    });
    console.log(`✓ Updated zuperItemId to ${CORRECT_ZUPER_UID}`);
  } else if (ip.zuperItemId === CORRECT_ZUPER_UID) {
    console.log("Already correct, nothing to do.");
  } else {
    console.log(`Unexpected zuperItemId: ${ip.zuperItemId} — not changing.`);
  }

  // Verify
  const updated = await prisma.internalProduct.findFirst({
    where: { brand: "Silfab", model: "SIL-400 HC+", isActive: true },
    select: { brand: true, model: true, zuperItemId: true, hubspotProductId: true, zohoItemId: true },
  });
  console.log(`After:`, updated);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
