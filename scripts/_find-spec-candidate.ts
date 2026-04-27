/**
 * Read-only: of the InternalProducts whose Zuper meta_data has cross-link
 * entries, find the ones that ALSO have a populated spec value matching a
 * FieldDef.zuperCustomField — these are candidates for M3.4 update-path
 * end-to-end verification.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_find-spec-candidate.ts
 */
import { prisma } from "@/lib/db";
import { getCategoryFields } from "@/lib/catalog-fields";

async function main() {
  if (!prisma) throw new Error("prisma not configured");

  const products = await prisma.internalProduct.findMany({
    where: { zuperItemId: { not: null }, isActive: true },
    include: {
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
  });

  const candidates: Array<{
    id: string;
    brand: string;
    model: string;
    category: string;
    populatedFields: Array<{ key: string; label: string; value: unknown }>;
  }> = [];

  for (const p of products) {
    const fields = getCategoryFields(p.category as string);
    const specSources: Array<Record<string, unknown> | null | undefined> = [
      p.moduleSpec as unknown as Record<string, unknown> | null,
      p.inverterSpec as unknown as Record<string, unknown> | null,
      p.batterySpec as unknown as Record<string, unknown> | null,
      p.evChargerSpec as unknown as Record<string, unknown> | null,
      p.mountingHardwareSpec as unknown as Record<string, unknown> | null,
      p.electricalHardwareSpec as unknown as Record<string, unknown> | null,
      p.relayDeviceSpec as unknown as Record<string, unknown> | null,
    ];

    const populated: Array<{ key: string; label: string; value: unknown }> = [];
    for (const spec of specSources) {
      if (!spec) continue;
      for (const f of fields) {
        if (!f.zuperCustomField) continue;
        const v = spec[f.key];
        if (v === null || v === undefined || v === "") continue;
        populated.push({ key: f.key, label: f.zuperCustomField, value: v });
      }
    }
    if (populated.length > 0) {
      candidates.push({
        id: p.id,
        brand: p.brand,
        model: p.model,
        category: p.category as string,
        populatedFields: populated,
      });
    }
  }

  console.log(`Found ${candidates.length} candidates with populated specs:`);
  for (const c of candidates) {
    console.log(`\n  ${c.id} | ${c.category} | ${c.brand} ${c.model}`);
    for (const f of c.populatedFields) {
      console.log(`    ${f.label.padEnd(35)} = ${JSON.stringify(f.value)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    if (prisma) void prisma.$disconnect();
  });
