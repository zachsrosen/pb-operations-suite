#!/usr/bin/env ts-node
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { CreateAdderSchema } from "@/lib/adders/zod-schemas";
import { VALID_SHOPS } from "@/lib/adders/pricing";

const CSV_PATH = process.argv[2] ?? "scripts/data/adders-seed.csv";
const SYSTEM_USER = "system-seed";

async function main() {
  const absPath = path.resolve(process.cwd(), CSV_PATH);
  if (!fs.existsSync(absPath)) {
    console.error(`CSV not found: ${absPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(absPath, "utf8");
  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  });

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const payload = toCreatePayload(row);
    const parsed = CreateAdderSchema.safeParse(payload);
    if (!parsed.success) {
      console.error(`Skip row ${row.code}: ${JSON.stringify(parsed.error.issues)}`);
      continue;
    }
    const existing = await prisma.adder.findUnique({ where: { code: row.code } });
    const data = {
      ...parsed.data,
      basePrice: parsed.data.basePrice,
      baseCost: parsed.data.baseCost,
      triggerLogic: parsed.data.triggerLogic ?? undefined,
      triageChoices: parsed.data.triageChoices ?? undefined,
      marginTarget: parsed.data.marginTarget ?? undefined,
    };
    if (existing) {
      await prisma.adder.update({
        where: { id: existing.id },
        data: { ...data, updatedBy: SYSTEM_USER },
      });
      updated++;
    } else {
      const adder = await prisma.adder.create({
        data: { ...data, createdBy: SYSTEM_USER, updatedBy: SYSTEM_USER },
      });
      await prisma.adderRevision.create({
        data: {
          adderId: adder.id,
          snapshot: adder as unknown as object,
          changedBy: SYSTEM_USER,
          changeNote: "seeded",
        },
      });
      created++;
    }

    // Shop overrides
    for (const shop of VALID_SHOPS) {
      const col = `override_${shop}`;
      const v = row[col]?.trim();
      if (!v) continue;
      const priceDelta = Number(v);
      if (Number.isNaN(priceDelta)) continue;
      const adder = await prisma.adder.findUniqueOrThrow({ where: { code: row.code } });
      await prisma.adderShopOverride.upsert({
        where: { adderId_shop: { adderId: adder.id, shop } },
        create: { adderId: adder.id, shop, priceDelta, active: true },
        update: { priceDelta, active: true },
      });
    }
  }
  console.log(`seed complete: ${created} created, ${updated} updated`);
  await prisma.$disconnect();
}

function toCreatePayload(row: Record<string, string>) {
  const num = (s: string | undefined) => (s ? Number(s) : undefined);
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    type: row.type || "FIXED",
    direction: row.direction || "ADD",
    autoApply: row.autoApply === "true",
    appliesTo: row.appliesTo || undefined,
    triggerCondition: row.triggerCondition || undefined,
    triageQuestion: row.triageQuestion || undefined,
    triageAnswerType: row.triageAnswerType || undefined,
    triggerLogic: row.triggerLogic ? JSON.parse(row.triggerLogic) : undefined,
    photosRequired: row.photosRequired === "true",
    unit: row.unit,
    basePrice: Number(row.basePrice),
    baseCost: Number(row.baseCost),
    marginTarget: num(row.marginTarget),
    notes: row.notes || undefined,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
