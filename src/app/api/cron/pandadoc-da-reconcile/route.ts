/**
 * GET /api/cron/pandadoc-da-reconcile
 *
 * Polls PandaDoc for recently-modified Design Approval documents and
 * compares each doc's terminal status against the deal's HubSpot
 * `layout_status`. Mismatches are written to `DaStatusDrift` for human
 * review (flag-only — no auto-correct).
 *
 * Auth: bearer `CRON_SECRET` header, mirrors other cron routes.
 * Feature flag: `PANDADOC_RECONCILE_ENABLED=true` to activate.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import {
  DA_TEMPLATE_ID,
  expectedLayoutStatus,
  extractHubspotDealId,
  getDocumentDetail,
  listDocumentsByTemplate,
} from "@/lib/pandadoc";

export const maxDuration = 60;

const LOOKBACK_HOURS = 2;

type ReconcileSummary = {
  scanned: number;
  terminal: number;
  matched: number;
  drifted: number;
  newDriftIds: string[];
  errors: string[];
};

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.PANDADOC_RECONCILE_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  if (!prisma) {
    return NextResponse.json({ status: "error", error: "Database not configured" }, { status: 500 });
  }

  const summary: ReconcileSummary = {
    scanned: 0,
    terminal: 0,
    matched: 0,
    drifted: 0,
    newDriftIds: [],
    errors: [],
  };

  try {
    const modifiedFrom = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    const docs = await listDocumentsByTemplate({
      templateId: DA_TEMPLATE_ID,
      modifiedFrom,
    });
    summary.scanned = docs.length;

    for (const doc of docs) {
      const expected = expectedLayoutStatus(doc.status);
      if (!expected) continue; // skip non-terminal (sent/viewed/draft) and ignored (expired)
      summary.terminal++;

      try {
        const detail = await getDocumentDetail(doc.id);
        const dealId = extractHubspotDealId(detail);
        if (!dealId) {
          summary.errors.push(`${doc.id}: no HubSpot deal linkage`);
          continue;
        }

        let actualLayoutStatus: string | null = null;
        try {
          const dealRes = await hubspotClient.crm.deals.basicApi.getById(dealId, [
            "layout_status",
          ]);
          actualLayoutStatus =
            (dealRes.properties?.layout_status as string | undefined) ?? null;
        } catch (err) {
          summary.errors.push(
            `${doc.id}/deal=${dealId}: hubspot fetch failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }

        if (actualLayoutStatus === expected) {
          summary.matched++;
          continue;
        }

        summary.drifted++;
        const drift = await prisma.daStatusDrift.upsert({
          where: { pandaDocId: doc.id },
          update: {
            // Refresh detection if the drift re-appears or context changed.
            hubspotDealId: dealId,
            templateId: detail.template?.id ?? null,
            documentName: detail.name,
            pandaDocStatus: doc.status,
            expectedHubspot: expected,
            actualHubspot: actualLayoutStatus,
            pandaDocSentAt: detail.date_sent ? new Date(detail.date_sent) : null,
            pandaDocCompleted: detail.date_completed
              ? new Date(detail.date_completed)
              : null,
            // Re-open if a previously resolved/ignored row drifts again.
            // Without this the silent-sync scenario this feature exists to
            // catch could be marked Resolved by an admin and never resurface.
            status: "OPEN",
            resolvedAt: null,
            resolvedBy: null,
            resolveNote: null,
          },
          create: {
            pandaDocId: doc.id,
            hubspotDealId: dealId,
            templateId: detail.template?.id ?? null,
            documentName: detail.name,
            pandaDocStatus: doc.status,
            expectedHubspot: expected,
            actualHubspot: actualLayoutStatus,
            pandaDocSentAt: detail.date_sent ? new Date(detail.date_sent) : null,
            pandaDocCompleted: detail.date_completed
              ? new Date(detail.date_completed)
              : null,
          },
        });
        summary.newDriftIds.push(drift.id);
      } catch (err) {
        summary.errors.push(
          `${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      lookbackHours: LOOKBACK_HOURS,
      ...summary,
    });
  } catch (err) {
    console.error("[pandadoc-da-reconcile] failed:", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        partial: summary,
      },
      { status: 500 },
    );
  }
}
