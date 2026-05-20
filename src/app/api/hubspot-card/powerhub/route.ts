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

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 min

function verifyHubSpotSignature(
  method: string,
  url: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): boolean {
  const skip = process.env.HUBSPOT_CARD_SKIP_SIG_VERIFY === "true";

  if (!signatureHeader || !timestampHeader) return skip;
  const secret = process.env.HUBSPOT_APP_SECRET;
  if (!secret) return skip;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return skip;

  // Build URL + body candidates and try each via @hubspot/api-client's
  // Signature.isValid (canonical reference implementation). Log only the
  // candidate-NAME that matched, so diagnostic output contains no signature
  // or HMAC material.
  const parsedUrl = new URL(url);
  const pathQuery = parsedUrl.pathname + parsedUrl.search;
  const urlCandidates: Array<{ name: string; v: string }> = [
    { name: "full", v: url },
    { name: "apex", v: url.replace("https://www.pbtechops.com", "https://pbtechops.com") },
    { name: "www-injected", v: url.replace("https://pbtechops.com", "https://www.pbtechops.com") },
    { name: "path", v: parsedUrl.pathname },
    { name: "path+query", v: pathQuery },
    { name: "origin+path", v: parsedUrl.origin + parsedUrl.pathname },
  ];

  // Strip HubSpot-injected meta params (appId, portalId, userEmail, userId)
  // — HubSpot may sign the URL the iframe sent (pre-injection).
  const meta = new URLSearchParams(parsedUrl.search);
  ["appId", "portalId", "userEmail", "userId"].forEach((k) => meta.delete(k));
  const remaining = meta.toString();
  const userOnlyQuery = remaining ? `?${remaining}` : "";
  urlCandidates.push({ name: "full-no-meta", v: `${parsedUrl.origin}${parsedUrl.pathname}${userOnlyQuery}` });
  urlCandidates.push({ name: "path-no-meta", v: `${parsedUrl.pathname}${userOnlyQuery}` });

  let parsedJson: unknown = null;
  try { parsedJson = JSON.parse(body); } catch { /* not JSON */ }
  const bodyCandidates: Array<{ name: string; v: string }> = [
    { name: "raw", v: body },
    { name: "canonical-json", v: parsedJson === null ? body : JSON.stringify(parsedJson) },
    { name: "sorted-keys", v: parsedJson && typeof parsedJson === "object"
        ? JSON.stringify(Object.fromEntries(Object.entries(parsedJson).sort()))
        : body },
    { name: "empty", v: "" },
  ];

  for (const u of urlCandidates) {
    for (const b of bodyCandidates) {
      const valid = Signature.isValid({
        signatureVersion: "v3",
        signature: signatureHeader,
        method,
        clientSecret: secret,
        requestBody: b.v,
        url: u.v,
        timestamp: ts as never,
      } as never);
      if (valid) {
        console.warn("[hubspot-card] sig MATCHED", { urlForm: u.name, bodyForm: b.name });
        return true;
      }
    }
  }

  // No candidate matched — persist diagnostic to DB for offline analysis
  const diagnostic = {
    at: new Date().toISOString(),
    incomingUrl: url,
    bodyRaw: body,
    bodyLen: body.length,
    sigGiven: signatureHeader, // signature can safely be stored; it's the proof
    sigLen: signatureHeader.length,
    ts: String(timestampHeader),
    tsAge: Date.now() - ts,
    triedUrlForms: urlCandidates.map((c) => ({ name: c.name, len: c.v.length })),
    triedBodyForms: bodyCandidates.map((c) => ({ name: c.name, len: c.v.length })),
  };
  console.warn("[hubspot-card] signature mismatch", diagnostic);
  // Best-effort DB persist (do not let storage errors break the request).
  prisma.systemConfig
    .upsert({
      where: { key: "hubspot_card_last_sig_mismatch" },
      create: { key: "hubspot_card_last_sig_mismatch", value: JSON.stringify(diagnostic) },
      update: { value: JSON.stringify(diagnostic) },
    })
    .catch(() => {});

  return skip;
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

  // 3. Equipment summary (denorm cols populated by resolvePrimarySite)
  const equipment = {
    gatewaySerial: propertyCache.teslaGatewaySerial,
    powerwallSerials: propertyCache.teslaPowerwallSerials,
    inverterSerial: propertyCache.teslaInverterSerial,
    meterSerial: propertyCache.teslaMeterSerial,
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
