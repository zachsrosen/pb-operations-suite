/**
 * Read-only scan: for each Zuper-linked InternalProduct, fetch the live
 * Zuper product and report meta_data label counts. Used to find a candidate
 * with populated meta_data (esp. cross-link IDs) for verifying the M3.4
 * update-path fix end-to-end.
 *
 * No writes. Pure GETs.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_scan-zuper-metadata.ts
 */
import { prisma } from "@/lib/db";
import { getZuperPartById } from "@/lib/zuper-catalog";

interface Row {
  productId: string;
  brand: string;
  model: string;
  category: string;
  zuperItemId: string;
  metaCount: number;
  labels: string[];
  hasCrossLink: boolean;
}

async function main() {
  if (!prisma) throw new Error("prisma not configured");

  const products = await prisma.internalProduct.findMany({
    where: { zuperItemId: { not: null }, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      brand: true,
      model: true,
      category: true,
      zuperItemId: true,
    },
  });

  console.log(`Scanning ${products.length} Zuper-linked products...`);

  const rows: Row[] = [];
  for (const p of products) {
    try {
      const part = await getZuperPartById(p.zuperItemId!);
      const meta =
        ((part as Record<string, unknown> | null | undefined)?.meta_data as
          | Array<{ label?: string }>
          | undefined) ?? [];
      const labels = meta
        .map((e) => (typeof e?.label === "string" ? e.label : null))
        .filter((s): s is string => !!s);
      const hasCrossLink = labels.some((l) =>
        /HubSpot Product ID|Internal Product ID|Zoho Item ID/i.test(l),
      );
      rows.push({
        productId: p.id,
        brand: p.brand,
        model: p.model,
        category: p.category,
        zuperItemId: p.zuperItemId!,
        metaCount: meta.length,
        labels,
        hasCrossLink,
      });
    } catch (e) {
      console.error(`  ${p.id} (${p.brand} ${p.model}): ${String(e).slice(0, 100)}`);
    }
  }

  rows.sort((a, b) => Number(b.hasCrossLink) - Number(a.hasCrossLink) || b.metaCount - a.metaCount);

  console.log("\nTop candidates (cross-link first, then by meta count):");
  for (const r of rows.slice(0, 15)) {
    const star = r.hasCrossLink ? "★" : " ";
    console.log(
      `  ${star} ${r.productId} | ${r.category.padEnd(15)} | ${r.brand} ${r.model}`,
    );
    console.log(`    meta=${r.metaCount} labels=${JSON.stringify(r.labels).slice(0, 200)}`);
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
