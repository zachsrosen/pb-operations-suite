/**
 * Backend for the Tesla PowerHub HubSpot UI Extension card.
 *
 * The card (React component at hubspot-extensions/src/app/extensions/
 * powerhub-card/PowerhubCard.tsx) POSTs here with the current HubSpot
 * record's objectType + objectId. We resolve the linked HubSpotPropertyCache
 * and return a card-ready payload: snapshot, equipment summary, active
 * alerts, deep-link URLs.
 *
 * Auth: HubSpot signs every request with HMAC-SHA256 using the app's client
 * secret. We verify X-HubSpot-Signature-V3 before responding. The signature
 * binds to method + URL + timestamp + body, so replays are caught by the
 * 5-minute timestamp window.
 *
 * Object type codes (HubSpot internal):
 *   0-3 = deals
 *   0-5 = tickets
 *   <portal-specific>  = custom Property object (HUBSPOT_PROPERTY_OBJECT_TYPE)
 */

import { NextResponse } from "next/server";
import { Signature } from "@hubspot/api-client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { teslaProductFromPartNumber, teslaDeviceLabel } from "@/lib/tesla-part-numbers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 min

/**
 * Verify a HubSpot UI Extension fetch using v3 HMAC-SHA256 signing.
 *
 * Canonical-form gotcha: HubSpot's hubspot.fetch proxy auto-injects
 * `?appId&portalId&userEmail&userId` query params and signs the URL
 * with those VALUES percent-DECODED (e.g. `userEmail=foo@bar.com`).
 * The HTTP layer then percent-ENCODES them in transit so my server
 * receives `userEmail=foo%40bar.com`. We reconstruct the canonical
 * URL by reading parsedUrl.searchParams (which decodes values) and
 * re-joining as `key=value` with no re-encoding.
 *
 * Reference algorithm (per HubSpot docs + @hubspot/api-client):
 *   sourceString = method + url + requestBody + timestamp
 *   signature = base64( HMAC-SHA256(clientSecret, sourceString) )
 */
function verifyHubSpotSignature(
  method: string,
  url: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): boolean {
  // Optional escape hatch for local dev only; should be unset in prod.
  if (process.env.HUBSPOT_CARD_SKIP_SIG_VERIFY === "true") return true;

  if (!signatureHeader || !timestampHeader) return false;
  const secret = process.env.HUBSPOT_APP_SECRET;
  if (!secret) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return false;

  // Canonical URL = origin + pathname + ?k=v&… with VALUES decoded.
  const parsed = new URL(url);
  const decodedPairs: string[] = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    decodedPairs.push(`${k}=${v}`);
  }
  const canonicalUrl =
    parsed.origin + parsed.pathname + (decodedPairs.length ? `?${decodedPairs.join("&")}` : "");

  return Signature.isValid({
    signatureVersion: "v3",
    signature: signatureHeader,
    method,
    clientSecret: secret,
    requestBody: body,
    url: canonicalUrl,
    timestamp: ts as never,
  } as never);
}

const TYPE_DEALS = "0-3";
const TYPE_TICKETS = "0-5";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("x-hubspot-signature-v3");
  const tsHeader = request.headers.get("x-hubspot-request-timestamp");
  const reqUrl = request.url;

  if (!verifyHubSpotSignature("POST", reqUrl, rawBody, sigHeader, tsHeader)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = RequestSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const { objectType, objectId } = parsed;
  const propertyObjectType = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;

  // 1. Resolve the HubSpotPropertyCache row for the incoming object.
  //    - For a Property record, the objectId IS the hubspotObjectId on the cache row
  //    - For Deals/Tickets, look up via PropertyDealLink / PropertyTicketLink
  let propertyCache;
  if (propertyObjectType && objectType === propertyObjectType) {
    propertyCache = await prisma.hubSpotPropertyCache.findUnique({
      where: { hubspotObjectId: objectId },
      include: {
        powerhubSites: {
          where: { primaryForProperty: true },
          include: { telemetrySnapshot: true, alerts: { where: { isActive: true } } },
        },
      },
    });
  } else if (objectType === TYPE_DEALS) {
    const link = await prisma.propertyDealLink.findFirst({
      where: { dealId: objectId },
      include: {
        property: {
          include: {
            powerhubSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true, alerts: { where: { isActive: true } } },
            },
          },
        },
      },
    });
    propertyCache = link?.property ?? null;
  } else if (objectType === TYPE_TICKETS) {
    const link = await prisma.propertyTicketLink.findFirst({
      where: { ticketId: objectId },
      include: {
        property: {
          include: {
            powerhubSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true, alerts: { where: { isActive: true } } },
            },
          },
        },
      },
    });
    propertyCache = link?.property ?? null;
  } else {
    return NextResponse.json(
      { error: "unsupported_object_type", message: `Object type ${objectType} not supported` },
      { status: 400 },
    );
  }

  if (!propertyCache) {
    // 404 → card renders the "no PowerHub link" empty state
    return NextResponse.json({ error: "no_property_link" }, { status: 404 });
  }

  const primarySite = propertyCache.powerhubSites[0] ?? null;
  if (!primarySite) {
    return NextResponse.json({ error: "no_primary_site" }, { status: 404 });
  }

  // 2. Build snapshot data with battery SoC derivation (same logic as
  //    /api/powerhub/properties/[id]/sites — see property-hub.ts).
  let batterySoc = primarySite.telemetrySnapshot?.batterySocPercent ?? null;
  if (
    batterySoc === null &&
    primarySite.telemetrySnapshot?.batteryEnergyRemainingWh != null &&
    primarySite.totalBatteryEnergy != null &&
    primarySite.totalBatteryEnergy > 0
  ) {
    batterySoc =
      (primarySite.telemetrySnapshot.batteryEnergyRemainingWh / primarySite.totalBatteryEnergy) *
      100;
  }

  const snapshot = primarySite.telemetrySnapshot
    ? {
        batterySocPercent: batterySoc,
        solarPowerW: primarySite.telemetrySnapshot.solarPowerW,
        batteryPowerW: primarySite.telemetrySnapshot.batteryPowerW,
        gridPowerW: primarySite.telemetrySnapshot.gridPowerW,
        loadPowerW: primarySite.telemetrySnapshot.loadPowerW,
        batteryMode: primarySite.telemetrySnapshot.batteryMode,
        lastTelemetryAt: primarySite.lastTelemetryAt?.toISOString() ?? null,
      }
    : null;

  // 3. Equipment summary — serials from denorm cols, models parsed live from
  //    PowerhubSite.devices JSON (so card sees model numbers without the
  //    backfill having to re-run).
  const deviceModels = extractDeviceModels(primarySite.devices);
  const equipment = {
    gatewaySerial: propertyCache.teslaGatewaySerial,
    powerwallSerials: propertyCache.teslaPowerwallSerials,
    inverterSerial: propertyCache.teslaInverterSerial,
    meterSerial: propertyCache.teslaMeterSerial,
    gatewayModel: deviceModels.gateway,
    powerwallModel: deviceModels.powerwall,
    inverterModel: deviceModels.inverter,
    meterModel: deviceModels.meter,
    batteryCount: primarySite.totalBatteries,
    batteryCapacityKwh:
      primarySite.totalBatteryEnergy != null
        ? primarySite.totalBatteryEnergy / 1000
        : null,
  };

  // 4. Active alerts (sorted critical first, then by age)
  const alerts = primarySite.alerts
    .sort((a, b) => {
      const sev = severityRank(a.severity) - severityRank(b.severity);
      if (sev !== 0) return sev;
      return a.reportedAt.getTime() - b.reportedAt.getTime();
    })
    .map((a) => ({
      name: a.alertName,
      severity: a.severity,
      daysOpen: Math.floor((Date.now() - a.reportedAt.getTime()) / 86_400_000),
    }));

  return NextResponse.json({
    propertyId: propertyCache.id,
    hubspotPropertyId: propertyCache.hubspotObjectId,
    siteName: primarySite.siteName,
    siteId: primarySite.siteId,
    teslaPortalUrl: propertyCache.teslaPortalUrl,
    pbTechOpsUrl: `https://pbtechops.com/properties/${propertyCache.hubspotObjectId}?tab=monitoring`,
    snapshot,
    equipment,
    alerts,
  });
}

function severityRank(s: string): number {
  if (s === "CRITICAL") return 0;
  if (s === "PERFORMANCE") return 1;
  return 2;
}

/**
 * Extract human-readable model name for each device class from the
 * PowerhubSite.devices JSON column. Picks the first non-empty value per
 * class — multi-pack sites typically share a model across units, but if
 * they differ we surface only the first to keep the card single-line.
 *
 * Raw Tesla part numbers (e.g. "1707000-XX-X") are translated to friendly
 * product names (e.g. "Powerwall 3") via the part-number prefix lookup.
 * For integrated battery+gateway units like Powerwall 3, the same product
 * is mirrored into the powerwall slot when no standalone battery is
 * reported — Tesla's API places PW3 units in the "gateways" bucket only.
 */
function extractDeviceModels(raw: unknown): {
  gateway: string | null;
  powerwall: string | null;
  inverter: string | null;
  meter: string | null;
} {
  const safe = (raw ?? {}) as Record<string, unknown>;
  const firstPn = (key: string): string | null => {
    const arr = safe[key];
    if (!Array.isArray(arr)) return null;
    for (const item of arr as Record<string, unknown>[]) {
      const pn = typeof item?.part_number === "string" ? item.part_number.trim() : "";
      if (pn) return pn;
    }
    return null;
  };
  const gatewayPn = firstPn("gateways");
  const batteryPn = firstPn("batteries");
  const inverterPn = firstPn("inverters");
  const meterPn = firstPn("meters");
  const gatewayProduct = teslaProductFromPartNumber(gatewayPn);

  return {
    gateway: gatewayPn ? teslaDeviceLabel(gatewayPn) : null,
    powerwall: batteryPn
      ? teslaDeviceLabel(batteryPn)
      : gatewayProduct?.integratedBatteryGateway
      ? teslaDeviceLabel(gatewayPn)
      : null,
    inverter: inverterPn ? teslaDeviceLabel(inverterPn) : null,
    meter: meterPn ? teslaDeviceLabel(meterPn) : null,
  };
}
