/**
 * Backfill: Write Internal Product ID (UUID) to all 3 external systems:
 *   1. HubSpot Products → internal_product_id property
 *   2. Zuper Products   → "Internal Product ID" via meta_data
 *   3. Zoho Items       → cf_internal_product_id custom field
 *
 * Pass --live to execute. Default is dry run.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, brand: true, model: true, name: true, hubspotProductId: true, zuperItemId: true, zohoItemId: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  console.log(`Active IPs: ${ips.length}\n`);

  // ── HubSpot ──
  const hsIps = ips.filter(ip => ip.hubspotProductId);
  console.log(`\n═══ HubSpot: ${hsIps.length} IPs with hubspotProductId ═══`);
  let hsUpdated = 0, hsFailed = 0, hsAlready = 0;

  for (const ip of hsIps) {
    const display = ip.name || `${ip.brand} ${ip.model}`;

    if (!DRY_RUN) {
      try {
        // Build all 3 cross-link properties
        const props: Record<string, string> = { internal_product_id: ip.id };
        if (ip.zuperItemId) props.zuper_item_id = ip.zuperItemId;
        if (ip.zohoItemId) props.zoho_item_id = ip.zohoItemId;

        // Check current values
        const getRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/products/${ip.hubspotProductId}?properties=internal_product_id,zuper_item_id,zoho_item_id`,
          { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
        );
        if (getRes.ok) {
          const data = await getRes.json() as any;
          const p = data.properties || {};
          if (p.internal_product_id === ip.id
              && (!ip.zuperItemId || p.zuper_item_id === ip.zuperItemId)
              && (!ip.zohoItemId || p.zoho_item_id === ip.zohoItemId)) {
            hsAlready++;
            continue;
          }
        }

        const res = await fetch(
          `https://api.hubapi.com/crm/v3/objects/products/${ip.hubspotProductId}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ properties: props }),
          }
        );
        if (res.ok) {
          hsUpdated++;
        } else {
          const err = await res.text();
          console.log(`  ✗ ${display}: ${res.status} — ${err.substring(0, 100)}`);
          hsFailed++;
        }
        await sleep(100); // Rate limit
      } catch (e: any) {
        console.log(`  ✗ ${display}: ${e.message}`);
        hsFailed++;
      }
    } else {
      hsUpdated++;
    }
  }
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${hsUpdated} | Already set: ${hsAlready} | Failed: ${hsFailed}`);

  // ── Zuper ──
  const zuperIps = ips.filter(ip => ip.zuperItemId);
  console.log(`\n═══ Zuper: ${zuperIps.length} IPs with zuperItemId ═══`);
  let zuperUpdated = 0, zuperFailed = 0, zuperAlready = 0;

  for (const ip of zuperIps) {
    const display = ip.name || `${ip.brand} ${ip.model}`;

    if (!DRY_RUN) {
      try {
        // Check current meta_data
        const getRes = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
          headers: { "x-api-key": ZUPER_API_KEY },
        });
        if (getRes.status !== 200) {
          console.log(`  ✗ ${display}: Zuper ${ip.zuperItemId} not found (${getRes.status})`);
          zuperFailed++;
          continue;
        }

        const d = await getRes.json() as any;
        const zp = d.data;

        // Check which fields need writing
        const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
        const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;

        let currentIpId: string | null = null;
        let currentZohoId: string | null = null;
        if (Array.isArray(meta)) {
          for (const m of meta) {
            if (m.label === "Internal Product ID" && m.value) currentIpId = String(m.value);
            if (m.label === "Zoho Item ID" && m.value) currentZohoId = String(m.value);
          }
        }
        if (!currentIpId && cfio?.product_internal_product_id_1) currentIpId = String(cfio.product_internal_product_id_1);
        if (!currentZohoId && cfio?.product_zoho_item_id_1) currentZohoId = String(cfio.product_zoho_item_id_1);

        const needsIpId = currentIpId !== ip.id;
        const needsZohoId = ip.zohoItemId && currentZohoId !== ip.zohoItemId;

        if (!needsIpId && !needsZohoId) {
          zuperAlready++;
          continue;
        }

        // Build updated meta_data — preserve existing, replace/add ours
        const existingMeta = Array.isArray(zp.meta_data) ? zp.meta_data : [];
        const filteredMeta = existingMeta.filter(
          (m: any) => m.label !== "Internal Product ID" && m.label !== "Zoho Item ID"
        );
        filteredMeta.push({ label: "Internal Product ID", value: ip.id });
        if (ip.zohoItemId) filteredMeta.push({ label: "Zoho Item ID", value: ip.zohoItemId });

        // Update
        const updateRes = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
          method: "PUT",
          headers: { "x-api-key": ZUPER_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            product: { meta_data: filteredMeta },
          }),
        });

        if (updateRes.ok) {
          zuperUpdated++;
        } else {
          const err = await updateRes.text();
          console.log(`  ✗ ${display}: ${updateRes.status} — ${err.substring(0, 100)}`);
          zuperFailed++;
        }
        await sleep(100);
      } catch (e: any) {
        console.log(`  ✗ ${display}: ${e.message}`);
        zuperFailed++;
      }
    } else {
      zuperUpdated++;
    }
  }
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${zuperUpdated} | Already set: ${zuperAlready} | Failed: ${zuperFailed}`);

  // ── Zoho ──
  const zohoIps = ips.filter(ip => ip.zohoItemId);
  console.log(`\n═══ Zoho: ${zohoIps.length} IPs with zohoItemId ═══`);
  let zohoUpdated = 0, zohoFailed = 0, zohoAlready = 0;

  for (const ip of zohoIps) {
    const display = ip.name || `${ip.brand} ${ip.model}`;

    if (!DRY_RUN) {
      try {
        // Check current value
        const rawItem = await (zohoInventory as any).request(`/items/${ip.zohoItemId}`);
        const item = rawItem.item || rawItem;
        const cf = item.custom_fields as Array<Record<string, unknown>> | undefined;
        let currentIpId: string | null = null;
        if (Array.isArray(cf)) {
          for (const f of cf) {
            if (f.api_name === "cf_internal_product_id" && f.value) currentIpId = String(f.value);
          }
        }

        if (currentIpId === ip.id) {
          zohoAlready++;
          continue;
        }

        // Update
        const result = await zohoInventory.updateItem(ip.zohoItemId!, {
          custom_fields: [{ api_name: "cf_internal_product_id", value: ip.id }],
        });

        if (result.status === "updated") {
          zohoUpdated++;
        } else {
          console.log(`  ✗ ${display}: ${result.message}`);
          zohoFailed++;
        }
        await sleep(100);
      } catch (e: any) {
        console.log(`  ✗ ${display}: ${e.message}`);
        zohoFailed++;
      }
    } else {
      zohoUpdated++;
    }
  }
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${zohoUpdated} | Already set: ${zohoAlready} | Failed: ${zohoFailed}`);

  // ── Summary ──
  console.log(`\n═══ Summary ═══`);
  console.log(`  HubSpot: ${hsUpdated} updated, ${hsAlready} already set, ${hsFailed} failed (of ${hsIps.length})`);
  console.log(`  Zuper:   ${zuperUpdated} updated, ${zuperAlready} already set, ${zuperFailed} failed (of ${zuperIps.length})`);
  console.log(`  Zoho:    ${zohoUpdated} updated, ${zohoAlready} already set, ${zohoFailed} failed (of ${zohoIps.length})`);

  if (DRY_RUN) console.log("\n*** Pass --live to execute ***");
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
