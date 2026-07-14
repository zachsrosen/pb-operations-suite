/**
 * _backfill-powerhub-device-counts.ts — recompute totalGateways/Batteries/
 * Inverters for PowerhubSite rows that contain a Powerwall 3 in the gateway
 * list, from the immutable `devices` JSON (Powerwall 3 → battery).
 *
 * IDEMPOTENT: counts are derived purely from the device array
 * (gateways-without-PW3, batteries+PW3), never from the mutable stored count,
 * so re-running is a no-op. Only PW3 sites are touched — the non-PW3
 * total_gateways-vs-array quirk is left to the live asset sync.
 *
 *   node --env-file=.env --import tsx scripts/_backfill-powerhub-device-counts.ts          # dry run
 *   node --env-file=.env --import tsx scripts/_backfill-powerhub-device-counts.ts --apply
 */
import { prisma } from "@/lib/db";
import { isPowerwallInGatewayList, type PowerhubDeviceSnapshot } from "@/lib/powerhub-devices";

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
    const gateways = snap.gateways ?? [];
    const pw3 = gateways.filter(isPowerwallInGatewayList).length;
    if (pw3 === 0) continue; // only Powerwall 3 sites

    // Array-based truth (idempotent): real gateways = non-PW3 devices; PW3 → battery.
    const nextGW = gateways.length - pw3;
    const nextBAT = (snap.batteries?.length ?? 0) + pw3;
    const nextINV = snap.inverters?.length ?? 0;
    if (nextGW === s.totalGateways && nextBAT === s.totalBatteries && nextINV === s.totalInverters) continue;

    changed++;
    if (samples.length < 8) samples.push(`  ${s.siteName}: GW ${s.totalGateways}->${nextGW}  BAT ${s.totalBatteries}->${nextBAT}  INV ${s.totalInverters}->${nextINV}`);
    if (!dryRun) {
      await prisma.powerhubSite.update({
        where: { siteId: s.siteId },
        data: { totalGateways: nextGW, totalBatteries: nextBAT, totalInverters: nextINV },
      });
    }
  }
  console.log(samples.join("\n"));
  console.log(JSON.stringify({ sitesScanned: sites.length, pw3SitesChanged: changed, dryRun }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
