import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const hubspot = await import("../src/lib/hubspot.js");

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Get all IP-linked Zuper IDs
  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null } },
    select: { zuperItemId: true },
  });
  const linkedZuperIds = new Set(ips.map(ip => ip.zuperItemId!));

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
  const withHs: Array<{ zuperUid: string; zuperName: string; hsId: string }> = [];

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
      withHs.push({
        zuperUid: zp.product_uid,
        zuperName: zp.product_name || "?",
        hsId,
      });
    }
  }

  // Batch-fetch HubSpot product names
  const hsIds = withHs.map(w => w.hsId);
  const hsNameMap = new Map<string, string>();

  // Fetch in batches of 100
  for (let i = 0; i < hsIds.length; i += 100) {
    const batch = hsIds.slice(i, i + 100);
    try {
      const res = await (hubspot as any).hubspotClient.crm.products.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: ["name"],
      });
      for (const p of res.results || []) {
        hsNameMap.set(p.id, p.properties?.name || "?");
      }
    } catch (e) {
      // Some IDs may not exist — fetch individually
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

  // Print sorted by Zuper name
  withHs.sort((a, b) => a.zuperName.localeCompare(b.zuperName));

  console.log(`Unlinked Zuper products with HubSpot IDs: ${withHs.length}\n`);
  console.log("Zuper Name".padEnd(50) + "HS Name".padEnd(50) + "HS ID");
  console.log("─".repeat(130));

  for (const w of withHs) {
    const hsName = hsNameMap.get(w.hsId) || "UNKNOWN";
    const zName = w.zuperName.length > 48 ? w.zuperName.substring(0, 45) + "…" : w.zuperName;
    const hName = hsName.length > 48 ? hsName.substring(0, 45) + "…" : hsName;
    console.log(`${zName.padEnd(50)}${hName.padEnd(50)}${w.hsId}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
