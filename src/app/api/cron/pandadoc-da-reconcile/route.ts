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
  expectedLayoutStatusForDoc,
  extractHubspotDealId,
  getDocumentDetail,
  isCandidateForReconcile,
  listDocumentsByTemplate,
  pickLatestDocPerDeal,
  type PandaDocDocumentDetail,
} from "@/lib/pandadoc";

export const maxDuration = 60;

const LOOKBACK_HOURS = 2;

type ReconcileSummary = {
  scanned: number;
  terminal: number;
  dealsConsidered: number;
  supersededByNewer: number;
  matched: number;
  drifted: number;
  autoResolved: number;
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
    dealsConsidered: 0,
    supersededByNewer: 0,
    matched: 0,
    drifted: 0,
    autoResolved: 0,
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

    // Phase 1: fetch detail for every terminal candidate so we can group
    // by HubSpot deal. We need detail anyway to read the dropdown.
    const withDealId: Array<{ detail: PandaDocDocumentDetail; dealId: string }> = [];
    for (const doc of docs) {
      if (!isCandidateForReconcile(doc.status)) continue;
      summary.terminal++;
      try {
        const detail = await getDocumentDetail(doc.id);
        const dealId = extractHubspotDealId(detail);
        if (!dealId) {
          summary.errors.push(`${doc.id}: no HubSpot deal linkage`);
          continue;
        }
        withDealId.push({ detail, dealId });
      } catch (err) {
        summary.errors.push(
          `${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Phase 2: dedupe per deal. Only the LATEST doc per deal is authoritative
    // — older revisions are stale (e.g. customer rejected v1, signed v2).
    const { latest, supersededPandaDocIds } = pickLatestDocPerDeal(withDealId);
    summary.dealsConsidered = latest.size;
    summary.supersededByNewer = supersededPandaDocIds.size;

    // Phase 3: for each deal's latest doc, compare against HubSpot.
    for (const [dealId, { detail }] of latest) {
      const expected = expectedLayoutStatusForDoc(detail);
      if (!expected) continue; // dropdown unanswered → can't determine intent

      let actualLayoutStatus: string | null = null;
      try {
        const dealRes = await hubspotClient.crm.deals.basicApi.getById(dealId, [
          "layout_status",
        ]);
        actualLayoutStatus =
          (dealRes.properties?.layout_status as string | undefined) ?? null;
      } catch (err) {
        summary.errors.push(
          `${detail.id}/deal=${dealId}: hubspot fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      // Whether HubSpot matches or not, any open drift rows for OLDER
      // revisions of this deal are now stale and should be auto-resolved.
      const autoResolveResult = await prisma.daStatusDrift.updateMany({
        where: {
          hubspotDealId: dealId,
          pandaDocId: { not: detail.id },
          status: "OPEN",
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: "system:superseded",
          resolveNote: `Superseded by newer DA revision (${detail.id})`,
        },
      });
      summary.autoResolved += autoResolveResult.count;

      if (actualLayoutStatus === expected) {
        summary.matched++;
        // If this deal's own latest doc had a prior OPEN drift row that has
        // since healed (HubSpot now matches expected), close it out too.
        await prisma.daStatusDrift.updateMany({
          where: { pandaDocId: detail.id, status: "OPEN" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: "system:healed",
            resolveNote: "HubSpot layout_status now matches PandaDoc dropdown",
          },
        });
        continue;
      }

      summary.drifted++;
      const drift = await prisma.daStatusDrift.upsert({
        where: { pandaDocId: detail.id },
        update: {
          hubspotDealId: dealId,
          templateId: detail.template?.id ?? null,
          documentName: detail.name,
          pandaDocStatus: detail.status,
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
          pandaDocId: detail.id,
          hubspotDealId: dealId,
          templateId: detail.template?.id ?? null,
          documentName: detail.name,
          pandaDocStatus: detail.status,
          expectedHubspot: expected,
          actualHubspot: actualLayoutStatus,
          pandaDocSentAt: detail.date_sent ? new Date(detail.date_sent) : null,
          pandaDocCompleted: detail.date_completed
            ? new Date(detail.date_completed)
            : null,
        },
      });
      summary.newDriftIds.push(drift.id);
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
