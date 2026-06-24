// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Participate Energy card — renders on HubSpot Deal record pages.
 * Surfaces, in priority order: milestone status (IC / PC) + payout $, any
 * open blockers (action-required / rejected docs with PE's reviewer reason),
 * the M1/M2 doc checklist, last PE sync time, and quick links.
 *
 * Data source: POST https://www.pbtechops.com/api/hubspot-card/pe
 *   Body: { objectType: "0-3", objectId: "..." }
 *   Response: { dealName, peProjectId, pePortalUrl, pbTechOpsUrl, lastSyncedAt,
 *               milestones, docs, blockers } | { error }
 *
 * Auth: HubSpot signs the request — the backend verifies the signature
 * against HUBSPOT_APP_SECRET before responding.
 */

import React, { useEffect, useState } from "react";
import {
  hubspot,
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
hubspot.extend(({ context }) => <PeCard context={context} />);

interface Milestone {
  status: string | null;
  amount: number | null;
  approvedOn: string | null;
  paidOn: string | null;
}

interface DocTally {
  total: number;
  approved: number;
  satisfied: number;
  blocked: number;
}

interface Blocker {
  doc: string;
  code: string | null;
  reviewer: string | null;
  reason: string | null;
  date: string | null;
}

interface CardData {
  dealName: string | null;
  peProjectId: string | null;
  pePortalUrl: string | null;
  pbTechOpsUrl: string;
  lastSyncedAt: string | null;
  milestones: { ic: Milestone; pc: Milestone };
  docs: { m1: DocTally; m2: DocTally };
  conditionalNote: boolean;
  blockers: Blocker[];
}

interface CardError {
  error: string;
  message?: string;
}

function PeCard({ context }: { context: any }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "data"; data: CardData } | { status: "error"; error: CardError } | { status: "no-pe" }
  >({ status: "loading" });

  useEffect(() => {
    const objectId = String(context.crm.objectId);
    const objectType = context.crm.objectTypeId;

    hubspot
      .fetch("https://www.pbtechops.com/api/hubspot-card/pe", {
        method: "POST",
        body: { objectType, objectId },
      })
      .then(async (r: Response) => {
        if (r.status === 404) {
          setState({ status: "no-pe" });
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
        <LoadingSpinner label="Loading Participate Energy status…" />
      </Flex>
    );
  }

  if (state.status === "no-pe") {
    return (
      <EmptyState title="Not a Participate Energy deal" layout="vertical">
        <Text>
          This deal isn't tagged Participate Energy and has no PE milestone
          status. Add the "Participate Energy" tag once the project enrolls.
        </Text>
      </EmptyState>
    );
  }

  if (state.status === "error") {
    return (
      <EmptyState title="Couldn't load PE status" layout="vertical">
        <Text format={{ italic: true }}>{state.error.message ?? state.error.error}</Text>
      </EmptyState>
    );
  }

  const { data } = state;
  const { ic, pc } = data.milestones;

  return (
    <>
      {/* Header — PE project + last sync */}
      <Flex direction="row" justify="between" align="center">
        <Box>
          <Heading>Participate Energy</Heading>
          {data.peProjectId && (
            <Text format={{ fontFamily: "monospace" }} variant="microcopy">
              {data.peProjectId}
            </Text>
          )}
        </Box>
        {data.lastSyncedAt && (
          <Text format={{ italic: true }} variant="microcopy">
            Synced {formatRelative(data.lastSyncedAt)}
          </Text>
        )}
      </Flex>

      <Divider />

      {/* Milestones — IC + PC status and payout */}
      <Flex direction="row" gap="md" wrap="wrap">
        <MilestoneTile label="M1 · Inspection Complete" m={ic} />
        <MilestoneTile label="M2 · Project Complete" m={pc} />
      </Flex>

      {/* Blockers — the thing you're here for */}
      {data.blockers.length > 0 && (
        <>
          <Divider />
          <Box>
            <Heading variant="h5">Needs attention ({data.blockers.length})</Heading>
            <Flex direction="column" gap="sm">
              {data.blockers.map((b, i) => (
                <Box key={i}>
                  <Flex direction="row" justify="between" align="center">
                    <Text format={{ fontWeight: "bold" }}>{b.doc}</Text>
                    {b.code && <Tag variant="danger">{b.code}</Tag>}
                  </Flex>
                  {b.reason && <Text variant="microcopy">{b.reason}</Text>}
                  {(b.reviewer || b.date) && (
                    <Text format={{ italic: true }} variant="microcopy">
                      {[b.reviewer, b.date].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </Box>
              ))}
            </Flex>
          </Box>
        </>
      )}

      {/* Doc checklist */}
      <Divider />
      <Box>
        <Heading variant="h5">Documents</Heading>
        <Flex direction="row" gap="md" wrap="wrap">
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>
              {data.docs.m1.satisfied}/{data.docs.m1.total}
            </Text>
            <Text variant="microcopy">M1 complete{data.docs.m1.blocked > 0 ? ` · ${data.docs.m1.blocked} flagged` : ""}</Text>
          </Tile>
          <Tile compact>
            <Text format={{ fontWeight: "bold" }}>
              {data.docs.m2.satisfied}/{data.docs.m2.total}
            </Text>
            <Text variant="microcopy">M2 complete{data.docs.m2.blocked > 0 ? ` · ${data.docs.m2.blocked} flagged` : ""}</Text>
          </Tile>
        </Flex>
        {data.conditionalNote && (
          <Text variant="microcopy" format={{ italic: true }}>
            Bill of Materials counts as complete when bundled in Photos (Not Required).
          </Text>
        )}
      </Box>

      <Divider />

      {/* Quick links */}
      <ButtonRow>
        <Button variant="primary" href={{ url: data.pbTechOpsUrl, external: true }}>
          Open PE Tracker
        </Button>
        {data.pePortalUrl && (
          <Button variant="secondary" href={{ url: data.pePortalUrl as string, external: true }}>
            Open PE Portal
          </Button>
        )}
      </ButtonRow>
    </>
  );
}

function MilestoneTile({ label, m }: { label: string; m: Milestone }) {
  return (
    <Tile compact>
      <Flex direction="row" justify="between" align="center" gap="sm">
        <Text format={{ fontWeight: "bold" }}>{label}</Text>
        {m.status && <Tag variant={statusVariant(m.status)}>{m.status}</Tag>}
      </Flex>
      <Text variant="microcopy">
        {m.amount != null ? formatUsd(m.amount) : "—"}
        {m.paidOn ? ` · paid ${m.paidOn}` : m.approvedOn ? ` · approved ${m.approvedOn}` : ""}
      </Text>
    </Tile>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
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

function statusVariant(status: string): "default" | "success" | "warning" | "danger" {
  const s = status.toLowerCase();
  if (s.includes("paid") || s.includes("approv") || s.includes("complete")) return "success";
  if (s.includes("reject")) return "danger";
  if (s.includes("action") || s.includes("resubmit") || s.includes("review")) return "warning";
  return "default";
}
