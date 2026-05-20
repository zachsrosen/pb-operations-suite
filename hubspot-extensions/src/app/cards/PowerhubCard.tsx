// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tesla PowerHub card — renders on HubSpot Deal, Ticket, and Property
 * record pages. Fetches live PowerHub data from PB Tech Ops Suite and
 * surfaces: current battery SoC, instant power flows, equipment serials,
 * active alerts, and one-click links to the suite + Tesla GridLogic portal.
 *
 * Data source: POST https://pbtechops.com/api/hubspot-card/powerhub
 *   Body: { objectType: "0-3" | "0-5" | "<property-type-id>", objectId: "..." }
 *   Response: { propertyId, siteName, snapshot, equipment, alerts, urls } | { error }
 *
 * Auth: HubSpot signs the request — the backend verifies the signature
 * against HUBSPOT_APP_SECRET before responding.
 */

import React, { useEffect, useState } from "react";
import {
  hubspot,
  Card,
  Heading,
  Text,
  Flex,
  Box,
  Button,
  ButtonRow,
  LoadingSpinner,
  Tile,
  Divider,
  EmptyState,
  Tag,
} from "@hubspot/ui-extensions";

// HubSpot UI Extensions entry point
hubspot.extend(({ context }) => <PowerhubCard context={context} />);

interface CardData {
  propertyId: string;
  hubspotPropertyId: string;
  siteName: string | null;
  siteId: string | null;
  teslaPortalUrl: string | null;
  pbTechOpsUrl: string;
  snapshot: {
    batterySocPercent: number | null;
    solarPowerW: number | null;
    batteryPowerW: number | null;
    gridPowerW: number | null;
    loadPowerW: number | null;
    batteryMode: string | null;
    lastTelemetryAt: string | null;
  } | null;
  equipment: {
    gatewaySerial: string | null;
    powerwallSerials: string | null;
    inverterSerial: string | null;
    meterSerial: string | null;
    batteryCount: number;
    batteryCapacityKwh: number | null;
  } | null;
  alerts: Array<{
    name: string;
    severity: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL";
    daysOpen: number;
  }>;
}

interface CardError {
  error: string;
  message?: string;
}

function PowerhubCard({ context }: { context: any }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "data"; data: CardData } | { status: "error"; error: CardError } | { status: "no-link" }
  >({ status: "loading" });

  useEffect(() => {
    const objectId = String(context.crm.objectId);
    const objectType = context.crm.objectTypeId;

    hubspot
      .fetch("https://www.pbtechops.com/api/hubspot-card/powerhub", {
        method: "POST",
        body: { objectType, objectId },
      })
      .then(async (r: Response) => {
        if (r.status === 404) {
          setState({ status: "no-link" });
          return;
        }
        const text = await r.text();
        if (!text) {
          setState({ status: "error", error: { error: `empty_response_status_${r.status}` } });
          return;
        }
        let json: any;
        try {
          json = JSON.parse(text);
        } catch (parseErr) {
          setState({ status: "error", error: { error: "non_json_response", message: `status=${r.status} body=${text.slice(0, 200)}` } });
          return;
        }
        if (json.error) {
          setState({ status: "error", error: json });
          return;
        }
        setState({ status: "data", data: json as CardData });
      })
      .catch((err: Error) => {
        setState({ status: "error", error: { error: "fetch_failed", message: String(err) } });
      });
  }, [context.crm.objectId, context.crm.objectTypeId]);

  if (state.status === "loading") {
    return (
      <Flex justify="center" align="center" padding="md">
        <LoadingSpinner label="Loading PowerHub data…" />
      </Flex>
    );
  }

  if (state.status === "no-link") {
    return (
      <EmptyState
        title="No Tesla PowerHub site linked"
        layout="vertical"
      >
        <Text>
          This record has no associated Tesla PowerHub system. Linking happens
          automatically once a site is geo-matched to the property's address.
        </Text>
      </EmptyState>
    );
  }

  if (state.status === "error") {
    return (
      <EmptyState title="Couldn't load PowerHub data" layout="vertical">
        <Text format={{ italic: true }}>
          {state.error.message ?? state.error.error}
        </Text>
      </EmptyState>
    );
  }

  const { data } = state;
  return (
    <>
      {/* Header — site name + status */}
      <Flex direction="row" justify="between" align="center">
        <Box>
          <Heading>{data.siteName ?? "Tesla PowerHub"}</Heading>
          {data.snapshot?.lastTelemetryAt && (
            <Text format={{ fontStyle: "italic" }} variant="microcopy">
              Last synced {formatRelative(data.snapshot.lastTelemetryAt)}
            </Text>
          )}
        </Box>
        {data.snapshot?.batterySocPercent != null && (
          <Tag variant={socTagVariant(data.snapshot.batterySocPercent)}>
            {data.snapshot.batterySocPercent.toFixed(0)}% battery
          </Tag>
        )}
      </Flex>

      <Divider />

      {/* Live power flows */}
      {data.snapshot && (
        <Flex direction="row" gap="md" wrap="wrap">
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>{formatPowerSigned(data.snapshot.solarPowerW)}</Text>
            <Text variant="microcopy">Solar {data.snapshot.solarPowerW && data.snapshot.solarPowerW > 0 ? "↑" : ""}</Text>
          </Tile>
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>{formatBatteryPower(data.snapshot.batteryPowerW)}</Text>
            <Text variant="microcopy">Battery {batteryDirection(data.snapshot.batteryPowerW)}</Text>
          </Tile>
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>{formatPowerSigned(data.snapshot.gridPowerW)}</Text>
            <Text variant="microcopy">Grid {gridDirection(data.snapshot.gridPowerW)}</Text>
          </Tile>
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>{formatPower(data.snapshot.loadPowerW)}</Text>
            <Text variant="microcopy">Load (home)</Text>
          </Tile>
        </Flex>
      )}

      {data.snapshot?.batteryMode && (
        <Text variant="microcopy">
          Mode: {formatBatteryMode(data.snapshot.batteryMode)}
        </Text>
      )}

      {/* Equipment */}
      {data.equipment && (
        <>
          <Divider />
          <Box>
            <Heading variant="h5">Hardware</Heading>
            {data.equipment.gatewaySerial && (
              <Text>
                Gateway: <Text inline format={{ fontFamily: "monospace" }}>{data.equipment.gatewaySerial}</Text>
              </Text>
            )}
            {data.equipment.powerwallSerials && (
              <Text>
                Powerwall: <Text inline format={{ fontFamily: "monospace" }}>{data.equipment.powerwallSerials}</Text>
                {data.equipment.batteryCount > 1 && ` (${data.equipment.batteryCount}×)`}
              </Text>
            )}
            {data.equipment.inverterSerial && (
              <Text>
                Inverter: <Text inline format={{ fontFamily: "monospace" }}>{data.equipment.inverterSerial}</Text>
              </Text>
            )}
            {data.equipment.meterSerial && (
              <Text>
                Meter: <Text inline format={{ fontFamily: "monospace" }}>{data.equipment.meterSerial}</Text>
              </Text>
            )}
            {data.equipment.batteryCapacityKwh != null && (
              <Text variant="microcopy">
                Capacity: {data.equipment.batteryCapacityKwh.toFixed(1)} kWh
              </Text>
            )}
          </Box>
        </>
      )}

      {/* Active alerts */}
      {data.alerts.length > 0 && (
        <>
          <Divider />
          <Box>
            <Heading variant="h5">
              Active alerts ({data.alerts.length})
            </Heading>
            <Flex direction="column" gap="xs">
              {data.alerts.slice(0, 5).map((a, i) => (
                <Flex key={i} direction="row" justify="between" align="center">
                  <Text>{a.name}</Text>
                  <Flex direction="row" gap="xs" align="center">
                    <Tag variant={alertTagVariant(a.severity)}>{a.severity}</Tag>
                    <Text variant="microcopy">{a.daysOpen}d</Text>
                  </Flex>
                </Flex>
              ))}
              {data.alerts.length > 5 && (
                <Text variant="microcopy">+{data.alerts.length - 5} more</Text>
              )}
            </Flex>
          </Box>
        </>
      )}

      <Divider />

      {/* Action buttons — UI Extension Button requires href prop for navigation; window.open is sandboxed and crashes the card. */}
      <ButtonRow>
        <Button
          variant="primary"
          href={{ url: data.pbTechOpsUrl, external: true }}
        >
          Open in PB Tech Ops
        </Button>
        {data.teslaPortalUrl && (
          <Button
            variant="secondary"
            href={{ url: data.teslaPortalUrl as string, external: true }}
          >
            Open Tesla Portal
          </Button>
        )}
      </ButtonRow>
    </>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}

function formatPowerSigned(w: number | null): string {
  return formatPower(w == null ? null : Math.abs(w));
}

function formatBatteryPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) < 50) return "Idle";
  return formatPower(Math.abs(w));
}

function batteryDirection(w: number | null): string {
  if (w == null || Math.abs(w) < 50) return "";
  return w > 0 ? "(discharging ↑)" : "(charging ↓)";
}

function gridDirection(w: number | null): string {
  if (w == null || Math.abs(w) < 50) return "";
  return w > 0 ? "(importing ↓)" : "(exporting ↑)";
}

function formatBatteryMode(code: string): string {
  const map: Record<string, string> = {
    "0": "Standby", "1": "Backup", "2": "Self-Consume", "3": "Time-of-Use",
    "4": "Autonomous", "5": "Sell to Grid", "6": "Site Master", "7": "Self-Powered",
    "8": "Backup Reserve", "9": "Off-Grid",
  };
  return map[code] ?? `Mode ${code}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function socTagVariant(soc: number): "default" | "success" | "warning" | "danger" {
  if (soc < 20) return "danger";
  if (soc < 40) return "warning";
  return "success";
}

function alertTagVariant(s: string): "default" | "success" | "warning" | "danger" {
  if (s === "CRITICAL") return "danger";
  if (s === "PERFORMANCE") return "warning";
  return "default";
}
