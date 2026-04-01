import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const hubspot = await import("../src/lib/hubspot.js");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Load all active IPs
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, brand: true, model: true, name: true, category: true,
              hubspotProductId: true, zuperItemId: true, zohoItemId: true },
  });
  const linkedZuperIds = new Set(allIPs.map(ip => ip.zuperItemId).filter(Boolean));
  const linkedHsIds = new Set(allIPs.map(ip => ip.hubspotProductId).filter(Boolean));

  // Build IP lookup by normalized name and by HS ID
  const ipByHsId = new Map<string, typeof allIPs[0]>();
  const ipByNormName = new Map<string, typeof allIPs[0][]>();
  for (const ip of allIPs) {
    if (ip.hubspotProductId) ipByHsId.set(ip.hubspotProductId, ip);
    const norm = normalize(ip.name || `${ip.brand} ${ip.model}`);
    if (!ipByNormName.has(norm)) ipByNormName.set(norm, []);
    ipByNormName.get(norm)!.push(ip);
  }

  // Load all Zoho items
  const zohoItems = await zohoInventory.getItemsForMatching();
  const zohoByNormName = new Map<string, typeof zohoItems[0][]>();
  const zohoByHsId = new Map<string, typeof zohoItems[0]>();
  for (const z of zohoItems) {
    const norm = normalize(z.name);
    if (!zohoByNormName.has(norm)) zohoByNormName.set(norm, []);
    zohoByNormName.get(norm)!.push(z);
    // Check custom fields for HS ID
    if (z.custom_fields) {
      for (const cf of z.custom_fields as any[]) {
        if (cf.label === "Hubspot Product ID" && cf.value) {
          zohoByHsId.set(String(cf.value), z);
        }
      }
    }
  }

  // Fetch all Zuper products
  let allZuper: any[] = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    allZuper.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  // Filter to unlinked with HS IDs
  const orphans: Array<{ zuperUid: string; zuperName: string; hsId: string }> = [];
  for (const zp of allZuper) {
    if (linkedZuperIds.has(zp.product_uid)) continue;
    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);
    if (hsId) {
      orphans.push({ zuperUid: zp.product_uid, zuperName: zp.product_name || "?", hsId });
    }
  }

  // Batch-fetch HubSpot product names
  const hsNameMap = new Map<string, string>();
  const uniqueHsIds = [...new Set(orphans.map(o => o.hsId))];
  for (let i = 0; i < uniqueHsIds.length; i += 100) {
    const batch = uniqueHsIds.slice(i, i + 100);
    try {
      const res = await (hubspot as any).hubspotClient.crm.products.batchApi.read({
        inputs: batch.map((id: string) => ({ id })),
        properties: ["name"],
      });
      for (const p of res.results || []) {
        hsNameMap.set(p.id, p.properties?.name || "?");
      }
    } catch {
      for (const id of batch) {
        try {
          const res = await (hubspot as any).hubspotClient.crm.products.basicApi.getById(id, ["name"]);
          hsNameMap.set(id, res.properties?.name || "?");
        } catch {
          hsNameMap.set(id, "DELETED");
        }
      }
    }
  }

  // Cross-reference each orphan
  orphans.sort((a, b) => a.zuperName.localeCompare(b.zuperName));

  const lines: string[] = [];
  lines.push(["Zuper Name", "HS Name", "HS ID", "IP Match?", "IP Details", "Zoho Match?", "Zoho Details"].join("\t"));

  for (const o of orphans) {
    const hsName = hsNameMap.get(o.hsId) || "UNKNOWN";
    const normZuper = normalize(o.zuperName);

    // Check IP match by HS ID
    let ipMatch = "";
    let ipDetails = "";
    const ipByHs = ipByHsId.get(o.hsId);
    if (ipByHs) {
      ipMatch = "YES (by HS ID)";
      ipDetails = `${ipByHs.name || `${ipByHs.brand} ${ipByHs.model}`} [${ipByHs.category}]`;
    } else {
      // Try by normalized name
      const ipByName = ipByNormName.get(normZuper);
      if (ipByName?.length) {
        ipMatch = "YES (by name)";
        ipDetails = ipByName.map(ip => `${ip.name || `${ip.brand} ${ip.model}`} [${ip.category}]`).join("; ");
      } else {
        // Try partial
        let found = false;
        for (const [norm, ips] of ipByNormName) {
          if (norm.length > 6 && normZuper.length > 6 && (norm.includes(normZuper) || normZuper.includes(norm))) {
            ipMatch = "PARTIAL (by name)";
            ipDetails = ips.map(ip => `${ip.name || `${ip.brand} ${ip.model}`}`).join("; ");
            found = true;
            break;
          }
        }
        if (!found) ipMatch = "NO";
      }
    }

    // Check Zoho match by HS ID
    let zohoMatch = "";
    let zohoDetails = "";
    const zohoByHs = zohoByHsId.get(o.hsId);
    if (zohoByHs) {
      zohoMatch = "YES (by HS ID)";
      zohoDetails = `${zohoByHs.name} [${zohoByHs.item_id}]`;
    } else {
      // Try by normalized name
      const zohoByName = zohoByNormName.get(normZuper);
      if (zohoByName?.length) {
        zohoMatch = "YES (by name)";
        zohoDetails = zohoByName.map(z => `${z.name} [${z.item_id}]`).join("; ");
      } else {
        zohoMatch = "NO";
      }
    }

    lines.push([o.zuperName, hsName, o.hsId, ipMatch, ipDetails, zohoMatch, zohoDetails].join("\t"));
  }

  const output = lines.join("\n");
  const fs = await import("fs");
  const outPath = "/tmp/zuper-orphan-crossref.tsv";
  fs.writeFileSync(outPath, output);
  console.log(`Written ${orphans.length} rows to ${outPath}`);

  // Summary
  const ipYes = lines.filter(l => l.includes("YES (by HS ID)") || l.includes("YES (by name)")).length - (lines[0].includes("YES") ? 1 : 0);
  const ipPartial = lines.filter(l => l.includes("PARTIAL")).length;
  const ipNo = lines.filter(l => l.split("\t")[3] === "NO").length;
  const zohoYes = lines.slice(1).filter(l => l.split("\t")[5]?.startsWith("YES")).length;
  const zohoNo = lines.slice(1).filter(l => l.split("\t")[5] === "NO").length;

  console.log(`\nIP matches:   ${ipYes} yes, ${ipPartial} partial, ${ipNo} no`);
  console.log(`Zoho matches: ${zohoYes} yes, ${zohoNo} no`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
