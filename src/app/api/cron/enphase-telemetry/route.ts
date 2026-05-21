import { NextResponse } from "next/server";
import { createEnphaseClient } from "@/lib/enphase-enlighten";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ENPHASE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "ENPHASE_ENABLED is false" });
  }

  try {
    const client = createEnphaseClient();
    const sites = await prisma.enphaseSite.findMany({
      select: { systemId: true },
    });

    let processed = 0;
    const errors: string[] = [];

    for (const site of sites) {
      try {
        const summary = await client.getSystemSummary(site.systemId);
        const now = new Date();
        const lastReportAt = summary.last_report_at
          ? new Date(summary.last_report_at * 1000)
          : null;

        await prisma.enphaseTelemetrySnapshot.upsert({
          where: { systemId: site.systemId },
          create: {
            systemId: site.systemId,
            timestamp: now,
            currentProductionW: summary.current_power ?? null,
            todayProductionWh: summary.energy_today ?? null,
            lifetimeProductionWh: summary.energy_lifetime ?? null,
            currentConsumptionW: summary.current_consumption ?? null,
            todayConsumptionWh: summary.consumption_today ?? null,
            lifetimeConsumptionWh: summary.consumption_lifetime ?? null,
            systemStatus: summary.status ?? null,
            microTotalCount: summary.modules ?? null,
            lastReportAt,
          },
          update: {
            timestamp: now,
            currentProductionW: summary.current_power ?? null,
            todayProductionWh: summary.energy_today ?? null,
            lifetimeProductionWh: summary.energy_lifetime ?? null,
            currentConsumptionW: summary.current_consumption ?? null,
            todayConsumptionWh: summary.consumption_today ?? null,
            lifetimeConsumptionWh: summary.consumption_lifetime ?? null,
            systemStatus: summary.status ?? null,
            microTotalCount: summary.modules ?? null,
            lastReportAt,
          },
        });

        // Append key metrics to history
        const historyEntries = [
          { signalName: "production_w", value: summary.current_power ?? null },
          { signalName: "consumption_w", value: summary.current_consumption ?? null },
        ].filter((e) => e.value != null);

        if (historyEntries.length > 0) {
          await prisma.enphaseTelemetryHistory.createMany({
            data: historyEntries.map((e) => ({
              systemId: site.systemId,
              timestamp: now,
              signalName: e.signalName,
              value: e.value,
              source: "POLL",
            })),
          });
        }

        await prisma.enphaseSite.update({
          where: { systemId: site.systemId },
          data: {
            lastTelemetrySyncAt: now,
            status: summary.status || "normal",
          },
        });

        processed++;
      } catch (err) {
        errors.push(
          `System ${site.systemId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      sitesProcessed: processed,
      totalSites: sites.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-telemetry] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
