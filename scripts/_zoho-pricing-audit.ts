import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { ZohoInventoryClient } from "../src/lib/zoho-inventory.js";
import * as fs from "fs";

async function main() {
  const zoho = new ZohoInventoryClient();
  if (!zoho.isConfigured()) {
    console.error("Zoho not configured");
    process.exit(1);
  }

  console.log("Fetching all Zoho Inventory items...");
  const allItems = await zoho.listItems();
  console.log("Total Zoho items:", allItems.length);

  // Load SO data to cross-reference which items are actually used
  const soData = JSON.parse(fs.readFileSync("scripts/2026-so-review.json", "utf-8"));
  const soItemNames = new Set<string>();
  const soItemSkus = new Set<string>();
  const soRatesByName: Record<string, number[]> = {};
  
  for (const so of soData.salesOrders) {
    for (const item of so.items) {
      soItemNames.add(item.name);
      if (item.sku) soItemSkus.add(item.sku);
      if (!soRatesByName[item.name]) soRatesByName[item.name] = [];
      soRatesByName[item.name].push(item.rate);
    }
  }

  // Categorize Zoho items
  const noCost: any[] = [];
  const noSell: any[] = [];
  const noBoth: any[] = [];
  const costEqualsSell: any[] = [];
  const healthy: any[] = [];
  const costMoreThanSell: any[] = [];

  for (const item of allItems) {
    if (item.status && item.status !== "active") continue;
    
    const cost = item.purchase_rate ?? null;
    const sell = item.rate ?? null;
    const onSO = soItemNames.has(item.name) || (item.sku && soItemSkus.has(item.sku));
    const soRates = soRatesByName[item.name] || [];
    const avgSoRate = soRates.length ? soRates.reduce((a,b)=>a+b,0)/soRates.length : null;
    
    const entry = {
      name: item.name,
      sku: item.sku || "",
      item_id: item.item_id,
      purchase_rate: cost,
      sell_rate: sell,
      on2026SO: !!onSO,
      soUses: soRates.length,
      avgSoRate: avgSoRate ? +avgSoRate.toFixed(2) : null
    };

    if (cost === null && sell === null) { noBoth.push(entry); }
    else if (cost === null || cost === 0) { noCost.push(entry); }
    else if (sell === null || sell === 0) { noSell.push(entry); }
    else if (cost === sell) { costEqualsSell.push(entry); }
    else if (cost > sell) { costMoreThanSell.push(entry); }
    else { healthy.push(entry); }
  }

  // Sort each group: items on SOs first, then by name
  const sortFn = (a: any, b: any) => (b.on2026SO ? 1 : 0) - (a.on2026SO ? 1 : 0) || a.name.localeCompare(b.name);
  noBoth.sort(sortFn);
  noCost.sort(sortFn);
  noSell.sort(sortFn);
  costEqualsSell.sort(sortFn);
  costMoreThanSell.sort(sortFn);
  healthy.sort(sortFn);

  const activeCount = allItems.filter(i => !i.status || i.status === "active").length;
  
  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("ZOHO INVENTORY — ITEM PRICING AUDIT");
  console.log("═══════════════════════════════════════════════════");
  console.log("Active Zoho items:", activeCount);
  console.log("No cost AND no sell price:", noBoth.length);
  console.log("No cost (sell exists):", noCost.length);
  console.log("No sell (cost exists):", noSell.length);
  console.log("Cost = Sell (zero margin):", costEqualsSell.length);
  console.log("Cost > Sell (negative margin):", costMoreThanSell.length);
  console.log("Healthy:", healthy.length);

  const printGroup = (title: string, items: any[], showPricing = true) => {
    console.log("");
    console.log("────────────────────────────────────────────────");
    console.log(title + " (" + items.length + ")");
    console.log("────────────────────────────────────────────────");
    
    const onSO = items.filter(i => i.on2026SO);
    const notOnSO = items.filter(i => !i.on2026SO);
    
    if (onSO.length > 0) {
      console.log("  ** ON 2026 SOs (" + onSO.length + "):");
      for (const i of onSO) {
        const pricing = showPricing ? ` | Cost: ${i.purchase_rate !== null ? "$" + i.purchase_rate : "NULL"} | Sell: ${i.sell_rate !== null ? "$" + i.sell_rate : "NULL"}` : "";
        const soInfo = i.soUses ? ` | SO uses: ${i.soUses}, avg rate: $${i.avgSoRate}` : "";
        console.log("    " + i.name + " (SKU: " + i.sku + ")" + pricing + soInfo);
      }
    }
    if (notOnSO.length > 0) {
      console.log("  Not on any 2026 SO (" + notOnSO.length + "):");
      for (const i of notOnSO) {
        const pricing = showPricing ? ` | Cost: ${i.purchase_rate !== null ? "$" + i.purchase_rate : "NULL"} | Sell: ${i.sell_rate !== null ? "$" + i.sell_rate : "NULL"}` : "";
        console.log("    " + i.name + " (SKU: " + i.sku + ")" + pricing);
      }
    }
  };

  printGroup("NO COST AND NO SELL PRICE", noBoth);
  printGroup("NO COST (has sell)", noCost);
  printGroup("NO SELL (has cost)", noSell);
  printGroup("COST = SELL (zero margin)", costEqualsSell);
  printGroup("COST > SELL (negative margin)", costMoreThanSell);
  printGroup("HEALTHY PRICING", healthy);
}

main().catch(console.error);
