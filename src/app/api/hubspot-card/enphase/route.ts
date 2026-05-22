/**
 * Backend for the Enphase Enlighten HubSpot UI Extension card.
 *
 * Same auth + resolution pattern as the PowerHub card at
 * src/app/api/hubspot-card/powerhub/route.ts.
 */

import { NextResponse } from "next/server";
import { Signature } from "@hubspot/api-client";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function verifyHubSpotSignature(
  method: string,
  url: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null
): boolean {
  if (process.env.HUBSPOT_CARD_SKIP_SIG_VERIFY === "true") return true;
  if (!signatureHeader || !timestampHeader) return false;
  const secret = process.env.HUBSPOT_APP_SECRET;
  if (!secret) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return false;

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

  if (!verifyHubSpotSignature("POST", request.url, rawBody, sigHeader, tsHeader)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = RequestSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const { objectType, objectId } = parsed;
  const propertyObjectType = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;

  let propertyCache;
  if (propertyObjectType && objectType === propertyObjectType) {
    propertyCache = await prisma.hubSpotPropertyCache.findUnique({
      where: { hubspotObjectId: objectId },
      include: {
        enphaseSites: {
          where: { primaryForProperty: true },
          include: { telemetrySnapshot: true },
        },
      },
    });
  } else if (objectType === TYPE_DEALS) {
    const link = await prisma.propertyDealLink.findFirst({
      where: { dealId: objectId },
      include: {
        property: {
          include: {
            enphaseSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true },
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
            enphaseSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true },
            },
          },
        },
      },
    });
    propertyCache = link?.property ?? null;
  } else {
    return NextResponse.json(
      { error: "unsupported_object_type", message: `Object type ${objectType} not supported` },
      { status: 400 }
    );
  }

  if (!propertyCache) {
    return NextResponse.json({ error: "no_property_link" }, { status: 404 });
  }

  const primarySite = propertyCache.enphaseSites[0] ?? null;
  if (!primarySite) {
    return NextResponse.json({ error: "no_enphase_site" }, { status: 404 });
  }

  const snapshot = primarySite.telemetrySnapshot
    ? {
        currentProductionW: primarySite.telemetrySnapshot.currentProductionW,
        todayProductionWh: primarySite.telemetrySnapshot.todayProductionWh,
        batteryPercentCharge: primarySite.telemetrySnapshot.batteryPercentCharge,
        systemStatus: primarySite.telemetrySnapshot.systemStatus || primarySite.status,
        microReportingCount: primarySite.telemetrySnapshot.microReportingCount,
        microTotalCount: primarySite.telemetrySnapshot.microTotalCount,
        lastReportAt: primarySite.telemetrySnapshot.lastReportAt?.toISOString() ?? null,
      }
    : null;

  const deviceModels = extractEnphaseDeviceModels(primarySite.devices);
  const equipment = {
    envoySerial: propertyCache.enphaseEnvoySerial,
    envoyModel: deviceModels.envoy,
    microModel: deviceModels.micro,
    microCount: primarySite.microinverterCount,
    batterySerials: propertyCache.enphaseBatterySerials,
    batteryModel: propertyCache.enphaseBatteryModel,
    batteryCount: primarySite.batteryCount,
    systemSizeKw: primarySite.systemSizeW ? primarySite.systemSizeW / 1000 : null,
  };

  return NextResponse.json({
    propertyId: propertyCache.id,
    hubspotPropertyId: propertyCache.hubspotObjectId,
    systemName: primarySite.systemName,
    systemId: primarySite.systemId,
    enphasePortalUrl: propertyCache.enphasePortalUrl,
    pbTechOpsUrl: `https://pbtechops.com/properties/${propertyCache.hubspotObjectId}?tab=monitoring`,
    snapshot,
    equipment,
  });
}

/**
 * Extract device models from EnphaseSite.devices JSON.
 * Mirrors extractDeviceModels() in the PowerHub card route.
 */
function extractEnphaseDeviceModels(raw: unknown): {
  envoy: string | null;
  micro: string | null;
} {
  const safe = (raw ?? {}) as Record<string, unknown>;
  const first = (key: string, field = "model"): string | null => {
    const arr = safe[key];
    if (!Array.isArray(arr)) return null;
    for (const item of arr as Record<string, unknown>[]) {
      const val = typeof item?.[field] === "string" ? (item[field] as string).trim() : "";
      if (val) return val;
    }
    return null;
  };
  return {
    envoy: first("enpower"),
    micro: first("micro_inverters"),
  };
}
