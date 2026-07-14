/**
 * _backfill-powerhub-device-counts.ts — recompute totalGateways/Batteries/
 * Inverters for every PowerhubSite from its stored `devices` JSON, using the
 * corrected classifier (Powerwall 3 → battery, not gateway).
 *
 * The asset-sync writer is fixed going forward, but only re-touches each site
 * every ~2 weeks; this corrects all existing rows now.
 *
 *   node --env-file=.env --import tsx scripts/_backfill-powerhub-device-counts.ts          # dry run
 *   node --env-file=.env --import tsx scripts/_backfill-powerhub-device-counts.ts --apply
 */
import { prisma } from "@/lib/db";
import { computeDeviceCounts, type PowerhubDeviceSnapshot } from "@/lib/powerhub-devices";

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const sites = await prisma.powerhubSite.findMany({
    select: { siteId: true, siteName: true, devices: true, totalGateways: true, totalBatteries: true, totalInverters: true },
  });

  let changed = 0;
  const samples: string[] = [];
  for (const s of sites) {
    const snap = (s.devices as PowerhubDeviceSnapshot | null) || null;
    if (!snap || typeof snap !== "object") continue;
    const next = computeDeviceCounts(snap, s.totalGateways);
    if (
      next.totalGateways === s.totalGateways &&
      next.totalBatteries === s.totalBatteries &&
      next.totalInverters === s.totalInverters
    ) continue;
    changed++;
    if (samples.length < 8) {
      samples.push(`  ${s.siteName}: GW ${s.totalGateways}->${next.totalGateways}  BAT ${s.totalBatteries}->${next.totalBatteries}  INV ${s.totalInverters}->${next.totalInverters}`);
    }
    if (!dryRun) {
      await prisma.powerhubSite.update({
        where: { siteId: s.siteId },
        data: { totalGateways: next.totalGateways, totalBatteries: next.totalBatteries, totalInverters: next.totalInverters },
      });
    }
  }
  console.log(samples.join("\n"));
  console.log(JSON.stringify({ sitesScanned: sites.length, sitesChanged: changed, dryRun }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
