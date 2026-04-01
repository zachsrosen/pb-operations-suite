import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const products = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, name: true, brand: true, model: true, category: true, unitCost: true, sellPrice: true, zohoItemId: true, hubspotProductId: true, zuperItemId: true }
  });
  
  const label = (p: any) => p.name || `${p.brand} ${p.model}`;
  
  const noPricing = products.filter(p => p.unitCost === null && p.sellPrice === null);
  const samePrice = products.filter(p => p.unitCost !== null && p.sellPrice !== null && Number(p.unitCost) === Number(p.sellPrice));
  const healthy = products.filter(p => p.unitCost !== null && p.sellPrice !== null && Number(p.unitCost) !== Number(p.sellPrice));
  const costOnly = products.filter(p => p.unitCost !== null && p.sellPrice === null);
  const priceOnly = products.filter(p => p.unitCost === null && p.sellPrice !== null);
  
  console.log("=== ACTIVE INTERNALPRODUCT PRICING HEALTH ===");
  console.log("Total active:", products.length);
  console.log("No pricing (both null):", noPricing.length);
  console.log("Cost = Sell (zero margin):", samePrice.length);
  console.log("Healthy (cost != sell):", healthy.length);
  console.log("Cost only:", costOnly.length);
  console.log("Sell only:", priceOnly.length);
  
  // COST = SELL
  console.log("");
  console.log("════════════════════════════════════════════");
  console.log("COST = SELL PRICE (zero margin)");
  console.log("════════════════════════════════════════════");
  samePrice.sort((a,b) => Number(b.unitCost!) - Number(a.unitCost!));
  for (const p of samePrice) {
    const linked = [p.zohoItemId ? "Zoho" : null, p.hubspotProductId ? "HS" : null, p.zuperItemId ? "Zuper" : null].filter(Boolean).join("+") || "NONE";
    console.log("  " + label(p));
    console.log("    " + p.category + " | Cost: $" + Number(p.unitCost).toFixed(2) + " | Sell: $" + Number(p.sellPrice).toFixed(2) + " | Linked: " + linked);
  }
  
  // "Healthy" but with bogus values
  console.log("");
  console.log("════════════════════════════════════════════");
  console.log("HAS PRICING (review for accuracy)");
  console.log("════════════════════════════════════════════");
  const withPricing = [...healthy, ...samePrice, ...priceOnly, ...costOnly];
  withPricing.sort((a,b) => a.category.localeCompare(b.category) || label(a).localeCompare(label(b)));
  for (const p of withPricing) {
    const cost = p.unitCost !== null ? "$" + Number(p.unitCost).toFixed(2) : "null";
    const sell = p.sellPrice !== null ? "$" + Number(p.sellPrice).toFixed(2) : "null";
    const margin = (p.unitCost !== null && p.sellPrice !== null && Number(p.sellPrice) > 0)
      ? ((Number(p.sellPrice) - Number(p.unitCost)) / Number(p.sellPrice) * 100).toFixed(1) + "%"
      : "N/A";
    const linked = [p.zohoItemId ? "Zoho" : null, p.hubspotProductId ? "HS" : null, p.zuperItemId ? "Zuper" : null].filter(Boolean).join("+") || "NONE";
    const flags = [];
    if (p.unitCost !== null && p.sellPrice !== null && Number(p.unitCost) === Number(p.sellPrice)) flags.push("ZERO-MARGIN");
    if (p.sellPrice !== null && Number(p.sellPrice) === 0) flags.push("SELL=$0");
    if (p.unitCost !== null && Number(p.unitCost) === 0) flags.push("COST=$0");
    if (p.unitCost !== null && p.sellPrice !== null && Number(p.unitCost) > Number(p.sellPrice)) flags.push("COST>SELL");
    if (p.unitCost === null) flags.push("NO-COST");
    if (p.sellPrice === null) flags.push("NO-SELL");
    const flagStr = flags.length ? " ⚠ " + flags.join(", ") : "";
    console.log("  " + label(p));
    console.log("    " + p.category + " | Cost: " + cost + " | Sell: " + sell + " | Margin: " + margin + " | " + linked + flagStr);
  }

  // NO PRICING — show with linked status and zoho item IDs
  console.log("");
  console.log("════════════════════════════════════════════");
  console.log("NO PRICING AT ALL (" + noPricing.length + " products)");
  console.log("════════════════════════════════════════════");
  const byCategory: Record<string, typeof noPricing> = {};
  for (const p of noPricing) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }
  for (const [cat, items] of Object.entries(byCategory).sort((a,b) => b[1].length - a[1].length)) {
    // Split by linked vs unlinked
    const linked = items.filter(p => p.zohoItemId || p.hubspotProductId || p.zuperItemId);
    const unlinked = items.filter(p => !p.zohoItemId && !p.hubspotProductId && !p.zuperItemId);
    console.log("  " + cat + " (" + items.length + " total, " + linked.length + " linked, " + unlinked.length + " unlinked):");
    for (const p of linked) {
      const links = [p.zohoItemId ? "Zoho" : null, p.hubspotProductId ? "HS" : null, p.zuperItemId ? "Zuper" : null].filter(Boolean).join("+");
      console.log("    ✦ " + label(p) + " [" + links + "]");
    }
    for (const p of unlinked) {
      console.log("    · " + label(p) + " [NONE]");
    }
  }
  
  await prisma.$disconnect();
}
main();
