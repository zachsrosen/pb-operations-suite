/**
 * One-shot: cascade the Tesla PowerHub URL + Site ID to Zuper Property + Job
 * records for every HubSpotPropertyCache that has both a teslaPortalUrl AND
 * a zuperPropertyUid set.
 *
 * Zuper auto-creates custom_field SCHEMAS on first write — no admin UI step
 * is required when the field doesn't already exist on the module.
 *
 * The 15-min zuper-property-sync cron will pick up changes automatically
 * once POWERHUB_ZUPER_CASCADE_ENABLED=true, but this script triggers the
 * cascade immediately for the initial backfill.
 *
 * Usage:
 *   POWERHUB_CROSSLINK_ENABLED=true POWERHUB_ZUPER_CASCADE_ENABLED=true \
 *     npx tsx scripts/backfill-zuper-tesla-fields.ts
 */
import { prisma } from "../src/lib/db";
import { cascadeUrlToJobs } from "../src/lib/zuper-property-sync";
import { mergeZuperMetaData, type ZuperMetaDataEntry } from "../src/lib/zuper-catalog";

const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

async function pushTeslaToProperty(
  zuperPropertyUid: string,
  teslaPortalUrl: string,
  teslaSiteId: string,
): Promise<boolean> {
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) {
    console.warn("ZUPER_API_KEY not configured; skipping property push");
    return false;
  }
  try {
    const getRes = await fetch(`${ZUPER_API_URL}/property/${zuperPropertyUid}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    if (!getRes.ok) {
      console.warn(`  property ${zuperPropertyUid} GET failed: ${getRes.status}`);
      return false;
    }
    const getJson = (await getRes.json()) as { data?: { custom_fields?: ZuperMetaDataEntry[] } };
    const existing = getJson.data?.custom_fields ?? [];
    const newFields: ZuperMetaDataEntry[] = [
      { label: "Tesla PowerHub", value: teslaPortalUrl, type: "SINGLE_LINE" },
      { label: "Tesla Site ID", value: teslaSiteId, type: "SINGLE_LINE" },
    ];
    const merged = mergeZuperMetaData(existing, newFields);
    const putRes = await fetch(`${ZUPER_API_URL}/property/${zuperPropertyUid}`, {
      method: "PUT",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ property: { custom_fields: merged } }),
    });
    if (!putRes.ok) {
      console.warn(`  property ${zuperPropertyUid} PUT failed: ${putRes.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`  property ${zuperPropertyUid} error:`, err);
    return false;
  }
}

(async () => {
  if (process.env.POWERHUB_ZUPER_CASCADE_ENABLED !== "true") {
    console.error("POWERHUB_ZUPER_CASCADE_ENABLED is not 'true'; cascadeUrlToJobs will no-op. Set it before running.");
    process.exit(1);
  }
  const props = await prisma.hubSpotPropertyCache.findMany({
    where: { teslaPortalUrl: { not: null }, zuperPropertyUid: { not: null } },
    select: { id: true, teslaPortalUrl: true, teslaSiteId: true, zuperPropertyUid: true, fullAddress: true },
  });
  console.log(`Found ${props.length} HubSpotPropertyCache rows with Tesla URL + Zuper UID`);

  let propsOk = 0;
  let propsFail = 0;
  for (const p of props) {
    const addr = p.fullAddress.substring(0, 45);
    process.stdout.write(`  ${addr.padEnd(46)} `);

    const propertyOk = await pushTeslaToProperty(
      p.zuperPropertyUid!,
      p.teslaPortalUrl!,
      p.teslaSiteId ?? "",
    );
    if (propertyOk) propsOk++; else propsFail++;

    // Also cascade to linked jobs via the production helper
    await cascadeUrlToJobs(p.id);
    console.log(propertyOk ? "✓" : "✗");
  }

  console.log(`\nDone. Properties: ${propsOk} ok, ${propsFail} failed.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
