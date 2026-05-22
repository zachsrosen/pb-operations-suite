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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Check sites that are unhealthy OR haven't reported recently
    const sites = await prisma.enphaseSite.findMany({
      where: {
        OR: [
          { status: { not: "normal" } },
          { lastTelemetrySyncAt: { lt: oneHourAgo } },
          { lastTelemetrySyncAt: null },
        ],
      },
      select: { id: true, systemId: true, status: true },
    });

    let processed = 0;
    let transitions = 0;
    const errors: string[] = [];

    for (const site of sites) {
      try {
        const devices = await client.getSystemDevices(site.systemId);
        const micros = devices.micro_inverters || [];
        const reporting = micros.filter((m) => m.status === "normal" || m.producing).length;
        const total = micros.length;

        // Determine new status based on device reporting
        let newStatus = "normal";
        if (total > 0 && reporting === 0) {
          newStatus = "comm";
        } else if (total > 0 && reporting < total) {
          newStatus = "micro";
        }

        const oldStatus = site.status;
        await prisma.enphaseSite.update({
          where: { id: site.id },
          data: {
            status: newStatus,
            lastStatusCheckAt: new Date(),
          },
        });

        // Update snapshot micro counts if snapshot exists
        await prisma.enphaseTelemetrySnapshot.updateMany({
          where: { systemId: site.systemId },
          data: {
            microReportingCount: reporting,
            microTotalCount: total,
            systemStatus: newStatus,
          },
        });

        if (oldStatus !== newStatus) {
          transitions++;
          console.log(
            `[enphase-status-check] System ${site.systemId}: ${oldStatus} → ${newStatus} (${reporting}/${total} micros reporting)`
          );
          // Log to audit trail for admin visibility
          try {
            await prisma.activityLog.create({
              data: {
                type: "ENPHASE_STATUS_CHANGE",
                description: `Enphase system ${site.systemId} status: ${oldStatus} → ${newStatus} (${reporting}/${total} micros)`,
                metadata: {
                  systemId: site.systemId,
                  oldStatus,
                  newStatus,
                  reporting,
                  total,
                },
              },
            });
          } catch {
            // Best-effort audit logging — don't fail the cron on log write errors
          }
        }

        processed++;
      } catch (err) {
        errors.push(
          `System ${site.systemId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      sitesChecked: processed,
      totalFlagged: sites.length,
      statusTransitions: transitions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-status-check] Check failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
