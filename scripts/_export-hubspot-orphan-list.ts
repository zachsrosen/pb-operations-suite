/**
 * Export the 230 HubSpot Product orphans (no internal_product_id) as a
 * CSV + Markdown table for review. Read-only.
 *
 * Output: scripts/hubspot-orphans.csv + scripts/hubspot-orphans.md
 *
 * Run: node --env-file=.env.local --import tsx scripts/_export-hubspot-orphan-list.ts
 */
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!HUBSPOT_TOKEN) { console.error("HUBSPOT_ACCESS_TOKEN missing"); process.exit(1); }

interface HsProduct {
  id: string;
  properties: Record<string, string>;
}

async function listAll(): Promise<HsProduct[]> {
  const all: HsProduct[] = [];
  let after: string | undefined;
  while (true) {
    const params = new URLSearchParams({
      limit: "100",
      properties: "name,hs_sku,internal_product_id,manufacturer,price,product_category,description,vendor_name,hs_lastmodifieddate,hs_createdate",
    });
    if (after) params.set("after", after);
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products?${params}`, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (!r.ok) break;
    const d = await r.json();
    for (const p of d.results || []) all.push(p);
    after = d.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

async function main() {
  console.log("Fetching all HubSpot Products...");
  const all = await listAll();
  console.log(`  ${all.length} total`);
  const orphans = all.filter((p) => !p.properties?.internal_product_id);
  console.log(`  ${orphans.length} orphans\n`);

  // Sort by category then name
  orphans.sort((a, b) => {
    const ca = a.properties?.product_category || "(none)";
    const cb = b.properties?.product_category || "(none)";
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.properties?.name || "").localeCompare(b.properties?.name || "");
  });

  // Categorize for the user
  const obviousLegacy = orphans.filter((p) => /\[?LEGACY|DO NOT USE|deprecated/i.test(p.properties?.name || ""));
  const serviceLineItems = orphans.filter((p) =>
    /^(Sales Tax|Travel|Permit Fees?|Inspection Fees?|Overnight|Add Sub|Adder|Service|Custom|Tax|Fee)\b/i.test(p.properties?.name || ""),
  );
  const otherOrphans = orphans.filter((p) =>
    !obviousLegacy.includes(p) && !serviceLineItems.includes(p),
  );

  console.log(`Obvious legacy ([LEGACY], DO NOT USE markers): ${obviousLegacy.length}`);
  console.log(`Service / line-item / fee:                     ${serviceLineItems.length}`);
  console.log(`Other (likely real-but-unlinked products):     ${otherOrphans.length}`);

  // ── CSV ──
  const fs = await import("fs");
  const csvHeader = ["id", "name", "hs_sku", "manufacturer", "product_category", "price", "description", "vendor_name", "hs_lastmodifieddate", "bucket"];
  const csvRows = [csvHeader.join(",")];
  function bucket(p: HsProduct): string {
    if (obviousLegacy.includes(p)) return "legacy";
    if (serviceLineItems.includes(p)) return "service";
    return "other";
  }
  function csvCell(v: string | undefined): string {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  for (const p of orphans) {
    const lastModRaw = p.properties?.hs_lastmodifieddate;
    let lastMod = "";
    if (lastModRaw) {
      const n = Number(lastModRaw);
      if (Number.isFinite(n) && n > 0) lastMod = new Date(n).toISOString().slice(0, 10);
      else if (typeof lastModRaw === "string" && lastModRaw.includes("-")) lastMod = lastModRaw.slice(0, 10);
    }
    csvRows.push([
      p.id,
      csvCell(p.properties?.name),
      csvCell(p.properties?.hs_sku),
      csvCell(p.properties?.manufacturer),
      csvCell(p.properties?.product_category),
      csvCell(p.properties?.price),
      csvCell(p.properties?.description?.slice(0, 100)),
      csvCell(p.properties?.vendor_name),
      lastMod,
      bucket(p),
    ].join(","));
  }
  fs.writeFileSync("scripts/hubspot-orphans.csv", csvRows.join("\n"));
  console.log("\nWrote scripts/hubspot-orphans.csv");

  // ── Markdown ──
  const mdLines: string[] = [];
  mdLines.push(`# HubSpot Product Orphans — ${orphans.length} total\n`);
  mdLines.push(`Pulled ${new Date().toISOString()}. None modified in 2026; none referenced by 2026 line items.\n`);
  mdLines.push(`## Summary\n`);
  mdLines.push(`| Bucket | Count | Notes |`);
  mdLines.push(`|---|---:|---|`);
  mdLines.push(`| Legacy markers in name | ${obviousLegacy.length} | "[LEGACY ...]", "DO NOT USE" — safe to archive |`);
  mdLines.push(`| Service / line-item / fee | ${serviceLineItems.length} | Sales Tax, Travel, Permit Fees, etc. — these aren't products |`);
  mdLines.push(`| Other orphans | ${otherOrphans.length} | Real-looking products that were never linked to InternalProduct |\n`);

  for (const [title, list] of [
    ["Legacy", obviousLegacy],
    ["Service / line-item / fee", serviceLineItems],
    ["Other orphans (real-looking, never linked)", otherOrphans],
  ] as const) {
    if (list.length === 0) continue;
    mdLines.push(`## ${title} (${list.length})\n`);
    mdLines.push(`| ID | Name | SKU | Manufacturer | Category | Price | Last Mod |`);
    mdLines.push(`|---|---|---|---|---|---:|---|`);
    for (const p of list) {
      const lastModRaw = p.properties?.hs_lastmodifieddate;
    let lastMod = "";
    if (lastModRaw) {
      const n = Number(lastModRaw);
      if (Number.isFinite(n) && n > 0) lastMod = new Date(n).toISOString().slice(0, 10);
      else if (typeof lastModRaw === "string" && lastModRaw.includes("-")) lastMod = lastModRaw.slice(0, 10);
    }
      mdLines.push(`| ${p.id} | ${p.properties?.name || ""} | ${p.properties?.hs_sku || ""} | ${p.properties?.manufacturer || ""} | ${p.properties?.product_category || ""} | ${p.properties?.price || ""} | ${lastMod} |`);
    }
    mdLines.push("");
  }
  fs.writeFileSync("scripts/hubspot-orphans.md", mdLines.join("\n"));
  console.log("Wrote scripts/hubspot-orphans.md");
}

main().catch((e) => { console.error(e); process.exit(1); });
