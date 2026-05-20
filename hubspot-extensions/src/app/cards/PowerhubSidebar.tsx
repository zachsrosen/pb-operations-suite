// Compact sidebar card — fast-glance Tesla PowerHub status for Deal, Ticket, Property.
// Shows: battery SOC + mode, alert count, single CTA to open the full tab/portal.
// Backend: same POST /api/hubspot-card/powerhub endpoint; rendered with smaller UI.
import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Divider,
  Flex,
  LoadingSpinner,
  Tag,
  Text,
  hubspot,
} from "@hubspot/ui-extensions";

interface CardData {
  propertyId: string;
  hubspotPropertyId: string;
  siteName: string;
  siteId: string | null;
  teslaPortalUrl: string | null;
  pbTechOpsUrl: string;
  snapshot: {
    batterySocPercent: number | null;
    batteryPowerW: number | null;
    solarPowerW: number | null;
    gridPowerW: number | null;
    loadPowerW: number | null;
    batteryMode: string | null;
    lastTelemetryAt: string | null;
  };
  equipment: {
    gatewaySerial: string | null;
    powerwallSerials: string | null;
    inverterSerial: string | null;
    meterSerial: string | null;
    batteryCount: number;
    batteryCapacityKwh: number | null;
  };
  alerts: Array<{ id: string; severity: string }>;
}

interface CardError {
  error: string;
  message?: string;
}

hubspot.extend(({ context }) => <PowerhubSidebar context={context} />);

function PowerhubSidebar({ context }: { context: any }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "data"; data: CardData }
    | { status: "error"; error: CardError }
    | { status: "no-link" }
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
        } catch {
          setState({ status: "error", error: { error: "non_json_response" } });
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
      <Flex justify="center" padding="sm">
        <LoadingSpinner size="sm" label="Loading…" />
      </Flex>
    );
  }

  if (state.status === "no-link") {
    return (
      <Box padding="sm">
        <Text variant="microcopy" format={{ color: "subdued" }}>
          No Tesla PowerHub linked to this record.
        </Text>
      </Box>
    );
  }

  if (state.status === "error") {
    return (
      <Box padding="sm">
        <Text variant="microcopy" format={{ color: "subdued" }}>
          PowerHub data unavailable.
        </Text>
      </Box>
    );
  }

  const { data } = state;
  const soc = data.snapshot.batterySocPercent;
  const socStr = soc == null ? "—" : `${Math.round(soc)}%`;
  const socTag: "success" | "warning" | "danger" | "default" =
    soc == null ? "default" : soc >= 50 ? "success" : soc >= 20 ? "warning" : "danger";
  const alertCount = data.alerts.length;
  const lastSyncedAgo = data.snapshot.lastTelemetryAt
    ? formatRelative(data.snapshot.lastTelemetryAt)
    : "never";

  return (
    <Flex direction="column" gap="extra-small">
      <Flex justify="between" align="center">
        <Text format={{ fontWeight: "demibold" }}>{data.siteName}</Text>
        <Tag variant={socTag}>{socStr} battery</Tag>
      </Flex>
      <Text variant="microcopy" format={{ color: "subdued" }}>
        Last sync {lastSyncedAgo} · Mode {batteryModeLabel(data.snapshot.batteryMode)}
      </Text>
      <Flex gap="small">
        <Field label="Solar" value={formatKW(data.snapshot.solarPowerW)} />
        <Field label="Grid" value={formatKW(data.snapshot.gridPowerW, true)} />
        <Field label="Load" value={formatKW(data.snapshot.loadPowerW)} />
      </Flex>
      {alertCount > 0 && (
        <Tag variant="danger">{alertCount} active alert{alertCount === 1 ? "" : "s"}</Tag>
      )}
      <Divider />
      <Button
        variant="primary"
        size="xs"
        href={{ url: data.pbTechOpsUrl, external: true }}
      >
        Open in PB Tech Ops
      </Button>
    </Flex>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Flex direction="column" gap="flush">
      <Text variant="microcopy" format={{ color: "subdued" }}>
        {label}
      </Text>
      <Text format={{ fontWeight: "demibold" }}>{value}</Text>
    </Flex>
  );
}

function formatKW(w: number | null, signed = false): string {
  if (w == null) return "—";
  const kw = w / 1000;
  if (signed) {
    const sign = kw < 0 ? "↑" : kw > 0 ? "↓" : "·";
    return `${Math.abs(kw).toFixed(1)} kW ${sign}`;
  }
  return `${kw.toFixed(1)} kW`;
}

function batteryModeLabel(mode: string | null): string {
  switch (mode) {
    case "7":
      return "Self-Powered";
    case "1":
      return "Backup";
    case "2":
      return "TBC";
    case "8":
      return "Cost-Saving";
    default:
      return mode ?? "—";
  }
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
