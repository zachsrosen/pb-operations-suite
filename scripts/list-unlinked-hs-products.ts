import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // All IPs with HS links
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true, hubspotProductId: { not: null } },
    select: { hubspotProductId: true, brand: true, model: true, name: true, category: true },
  });
  const linkedHsIds = new Set(allIPs.map(p => p.hubspotProductId!));

  // Fetch all HubSpot products
  let allHs: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  while (true) {
    const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=name,hs_sku,price,createdate,hs_lastmodifieddate${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${HS_TOKEN}` } });
    const data = await res.json() as Record<string, unknown>;
    const results = ((data as any).results || []) as Array<Record<string, unknown>>;
    allHs.push(...results);
    const paging = (data as any).paging;
    if (paging?.next?.after) { after = paging.next.after; } else { break; }
  }

  console.log(`Total HubSpot products: ${allHs.length}`);
  console.log(`Linked to an IP: ${allHs.filter(p => linkedHsIds.has(String(p.id))).length}`);

  const unlinked = allHs.filter(p => !linkedHsIds.has(String(p.id)));
  console.log(`NOT linked to any IP: ${unlinked.length}\n`);

  // Sort by name
  unlinked.sort((a, b) => {
    const na = String((a.properties as any)?.name || "").toLowerCase();
    const nb = String((b.properties as any)?.name || "").toLowerCase();
    return na.localeCompare(nb);
  });

  for (const hp of unlinked) {
    const props = hp.properties as Record<string, unknown>;
    const id = String(hp.id);
    const name = String(props?.name || "");
    const sku = String(props?.hs_sku || "");
    const price = props?.price ? `$${Number(props.price).toFixed(2)}` : "";
    console.log(`${id.padEnd(14)} ${name.padEnd(60)} SKU: ${sku.padEnd(30)} ${price}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
