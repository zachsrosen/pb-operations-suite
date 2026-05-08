import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const [
    siteCount,
    activeSites,
    provisionedSites,
    snapshots,
    activeAlerts,
  ] = await Promise.all([
    prisma.powerhubSite.count(),
    prisma.powerhubSite.count({ where: { status: "ACTIVE" } }),
    prisma.powerhubSite.count({
      where: {
        OR: [
          { totalGateways: { gt: 0 } },
          { totalBatteries: { gt: 0 } },
          { totalInverters: { gt: 0 } },
        ],
      },
    }),
    prisma.powerhubTelemetrySnapshot.findMany({
      select: {
        solarPowerW: true,
        batterySocPercent: true,
        gridConnectedStatus: true,
      },
    }),
    prisma.powerhubAlert.count({ where: { isActive: true } }),
  ]);

  const totalSolarPowerW = snapshots.reduce(
    (sum, s) => sum + (s.solarPowerW || 0),
    0
  );
  const socValues = snapshots.filter((s) => s.batterySocPercent != null);
  const avgBatterySoc =
    socValues.length > 0
      ? socValues.reduce((sum, s) => sum + (s.batterySocPercent || 0), 0) /
        socValues.length
      : null;
  const gridConnectedCount = snapshots.filter(
    (s) => s.gridConnectedStatus === "Grid Connected"
  ).length;

  return NextResponse.json({
    fleet: {
      totalSites: siteCount,
      activeSites,
      provisionedSites,
      sitesReporting: snapshots.length,
      totalSolarPowerW,
      avgBatterySocPercent:
        avgBatterySoc ? Math.round(avgBatterySoc * 10) / 10 : null,
      gridConnectedCount,
      gridDisconnectedCount: activeSites - gridConnectedCount,
      activeAlertCount: activeAlerts,
    },
  });
}
