import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { ZohoInventoryClient } from "../src/lib/zoho-inventory.js";
import * as fs from "fs";

async function main() {
  const zoho = new ZohoInventoryClient();
  const allItems = await zoho.listItems();
  
  const soData = JSON.parse(fs.readFileSync("scripts/2026-so-review.json", "utf-8"));
  const soRatesByName: Record<string, number[]> = {};
  for (const so of soData.salesOrders) {
    for (const item of so.items) {
      if (!soRatesByName[item.name]) soRatesByName[item.name] = [];
      soRatesByName[item.name].push(item.rate);
    }
  }

  const results: any[] = [];
  for (const item of allItems) {
    if (item.status && item.status !== "active") continue;
    const cost = item.purchase_rate ?? 0;
    const sell = item.rate ?? 0;
    const soRates = soRatesByName[item.name] || [];
    const avgSoRate = soRates.length ? +(soRates.reduce((a,b)=>a+b,0)/soRates.length).toFixed(2) : null;
    
    let category: string;
    if (cost === 0 && sell === 0) category = "no_both";
    else if (cost === 0) category = "no_cost";
    else if (sell === 0) category = "no_sell";
    else if (cost === sell) category = "cost_eq_sell";
    else if (cost > sell) category = "cost_gt_sell";
    else category = "healthy";

    results.push({
      name: item.name, sku: item.sku || "", item_id: item.item_id,
      cost, sell, category,
      on_so: soRates.length > 0, so_uses: soRates.length, avg_so_rate: avgSoRate
    });
  }
  
  fs.writeFileSync("scripts/2026-zoho-pricing-audit.json", JSON.stringify(results, null, 2));
  
  const cats: Record<string, number> = {};
  const catsOnSO: Record<string, number> = {};
  for (const r of results) {
    cats[r.category] = (cats[r.category] || 0) + 1;
    if (r.on_so) catsOnSO[r.category] = (catsOnSO[r.category] || 0) + 1;
  }
  console.log("Total:", results.length);
  console.log(JSON.stringify({ counts: cats, onSO: catsOnSO }, null, 2));
}
main();
