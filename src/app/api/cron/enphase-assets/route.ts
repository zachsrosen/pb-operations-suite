import { NextResponse } from "next/server";
import { createEnphaseClient, computeEnphasePortalUrl } from "@/lib/enphase-enlighten";
import { enqueueCrossSystemPush } from "@/lib/enphase-crosslink";
import { normalizeAddress, computeAddressHash } from "@/lib/powerhub-linkage";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const systems = await client.listSystems();

    let created = 0;
    let updated = 0;
    let linked = 0;
    const errors: string[] = [];

    for (const system of systems) {
      try {
        const street = system.address?.address1 || "";
        const city = system.address?.city || "";
        const state = system.address?.state || "";
        const zip = system.address?.postal_code || null;
        const normalizedStreet = normalizeAddress(street);
        const addressHash =
          street && city && state
            ? computeAddressHash(
                normalizedStreet,
                city.toLowerCase(),
                state.toLowerCase(),
                zip
              )
            : null;

        const portalUrl = computeEnphasePortalUrl(system.system_id);
        const operationalAt = system.meta?.operational_at
          ? new Date(system.meta.operational_at * 1000)
          : null;

        // Fetch devices for this system
        let devices = {};
        try {
          devices = await client.getSystemDevices(system.system_id);
        } catch (err) {
          errors.push(
            `Device fetch failed for ${system.system_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        const microCount = Array.isArray(
          (devices as Record<string, unknown>).micro_inverters
        )
          ? ((devices as Record<string, unknown>).micro_inverters as unknown[]).length
          : 0;
        const batteryCount = [
          ...(((devices as Record<string, unknown>).batteries as unknown[]) || []),
          ...(((devices as Record<string, unknown>).encharges as unknown[]) || []),
        ].length;

        // Find envoy serial from enpower devices
        const enpowerDevices = (devices as Record<string, unknown>).enpower;
        const envoySerial =
          Array.isArray(enpowerDevices) && enpowerDevices.length > 0
            ? String(
                (enpowerDevices[0] as Record<string, unknown>).serial_number || ""
              )
            : null;

        const existing = await prisma.enphaseSite.findUnique({
          where: { systemId: system.system_id },
        });

        if (existing) {
          await prisma.enphaseSite.update({
            where: { systemId: system.system_id },
            data: {
              systemName: system.system_name,
              systemPublicName: system.system_public_name || null,
              address: street,
              city,
              state,
              zip,
              addressHash,
              portalUrl,
              modules: system.modules || 0,
              systemSizeW: system.system_size || null,
              timezone: system.timezone || null,
              connectionType: system.connection_type || null,
              envoySerial,
              status: system.status || "normal",
              operationalAt,
              devices: devices as object,
              microinverterCount: microCount,
              batteryCount,
              lastAssetSyncAt: new Date(),
            },
          });
          updated++;
        } else {
          await prisma.enphaseSite.create({
            data: {
              systemId: system.system_id,
              systemName: system.system_name,
              systemPublicName: system.system_public_name || null,
              address: street,
              city,
              state,
              zip,
              addressHash,
              portalUrl,
              modules: system.modules || 0,
              systemSizeW: system.system_size || null,
              timezone: system.timezone || null,
              connectionType: system.connection_type || null,
              envoySerial,
              status: system.status || "normal",
              operationalAt,
              devices: devices as object,
              microinverterCount: microCount,
              batteryCount,
              lastAssetSyncAt: new Date(),
            },
          });
          created++;
        }

        // Auto-link by addressHash if unlinked
        if (addressHash) {
          const site = await prisma.enphaseSite.findUnique({
            where: { systemId: system.system_id },
          });
          if (site && site.linkMethod === "UNLINKED") {
            const propertyMatch = await prisma.hubSpotPropertyCache.findFirst({
              where: { addressHash },
            });
            if (propertyMatch) {
              await prisma.enphaseSite.update({
                where: { id: site.id },
                data: {
                  propertyId: propertyMatch.id,
                  linkMethod: "ADDRESS_MATCH",
                  linkConfidence: "MEDIUM",
                },
              });
              linked++;
              await enqueueCrossSystemPush(propertyMatch.id);
            }
          }
        }
      } catch (err) {
        errors.push(
          `System ${system.system_id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      sitesProcessed: systems.length,
      created,
      updated,
      linked,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-assets] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
