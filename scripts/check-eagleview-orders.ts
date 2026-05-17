import { prisma } from "../src/lib/db";

async function main() {
  const dealId = process.argv[2] ?? "59382535039";
  const orders = await prisma.eagleViewOrder.findMany({
    where: { dealId },
    orderBy: { orderedAt: "desc" },
    take: 10,
  });
  console.log(`\nOrders for deal ${dealId}: ${orders.length}\n`);
  for (const o of orders) {
    console.log(
      `  ${o.reportId.padEnd(20)} ${o.status.padEnd(10)} $${o.cost ?? "?"} | ${o.triggeredBy.slice(0, 40).padEnd(40)} | ${o.orderedAt.toISOString()}`,
    );
    if (o.errorMessage) console.log(`    err: ${o.errorMessage}`);
  }
  await prisma.$disconnect();
}

main();
