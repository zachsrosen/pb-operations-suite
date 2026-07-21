/**
 * GET /api/cron/approval-scan
 *
 * Daily approval-signal inbox scan for the P&I hub. Chunked: each run scans
 * ~25 candidate deals for ONE mode (permit → ic → pto → inspection), rotating
 * a SystemConfig watermark so successive runs cover the whole candidate set
 * without a single long tick (the zuper-status-reconcile 504 lesson).
 *
 * Auth: bearer CRON_SECRET. Feature flag: APPROVAL_SCAN_ENABLED=true — the
 * route 404s while off so shadow rollout is invisible.
 * Flag-only — never writes HubSpot statuses.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { EXCLUDED_STAGES, INCLUDED_PIPELINES } from "@/lib/daily-focus/config";
import { TEAM_CONFIGS } from "@/lib/pi-hub/config";
import {
  isInspectionCandidate,
  PTO_AT_OR_PAST_INSPECTION,
} from "@/lib/approval-scan/classify";
import {
  CANDIDATE_STATUSES,
  liveScanDeps,
  scanApprovalSignals,
  SCAN_IDENTIFIER_PROPERTIES,
  SCAN_MODES,
  signalTeamForMode,
  type CandidateDeal,
  type ExistingSignalRow,
  type ScanMode,
  type SignalStatus,
} from "@/lib/approval-scan/scan";
import type {
  ApprovalVerdict,
  SignalType,
  VerdictConfidence,
} from "@/lib/approval-scan/classify";

export const runtime = "nodejs";
export const maxDuration = 120;

/** ~25 deals per tick keeps a run well under maxDuration even when every
 *  message goes to the LLM. */
const CHUNK_SIZE = 25;

const WATERMARK_KEY = "approval_scan_watermark";

interface Watermark {
  mode: ScanMode;
  /** hs_object_id cursor — deals with an id GT this are next. */
  after: string;
}

function parseWatermark(raw: string | undefined | null): Watermark {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<Watermark>;
    if (
      parsed.mode &&
      (SCAN_MODES as readonly string[]).includes(parsed.mode) &&
      typeof parsed.after === "string"
    ) {
      return { mode: parsed.mode, after: parsed.after };
    }
  } catch {
    // fall through — corrupt/missing watermark restarts the rotation
  }
  return { mode: SCAN_MODES[0], after: "0" };
}

function nextMode(mode: ScanMode): ScanMode {
  const idx = SCAN_MODES.indexOf(mode);
  return SCAN_MODES[(idx + 1) % SCAN_MODES.length];
}

/** Candidate search for one mode, cursored on hs_object_id ascending. */
async function fetchCandidates(
  mode: ScanMode,
  after: string,
): Promise<CandidateDeal[]> {
  const commonFilters = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.In,
      values: INCLUDED_PIPELINES,
    },
    {
      propertyName: "dealstage",
      operator: FilterOperatorEnum.NotIn,
      values: EXCLUDED_STAGES,
    },
    {
      propertyName: "hs_object_id",
      operator: FilterOperatorEnum.Gt,
      value: after,
    },
  ];

  let filterGroups: Array<{ filters: Record<string, unknown>[] }>;
  if (mode === "inspection") {
    const permitComplete = {
      propertyName: TEAM_CONFIGS.permit.statusProperty,
      operator: FilterOperatorEnum.Eq,
      value: "Complete",
    };
    // Two OR'd groups because HubSpot's NOT_IN drops property-missing rows —
    // a deal that never got a pto_status is still an inspection candidate.
    filterGroups = [
      {
        filters: [
          permitComplete,
          {
            propertyName: TEAM_CONFIGS.pto.statusProperty,
            operator: FilterOperatorEnum.NotIn,
            values: [...PTO_AT_OR_PAST_INSPECTION],
          },
          ...commonFilters,
        ],
      },
      {
        filters: [
          permitComplete,
          {
            propertyName: TEAM_CONFIGS.pto.statusProperty,
            operator: FilterOperatorEnum.NotHasProperty,
          },
          ...commonFilters,
        ],
      },
    ];
  } else {
    filterGroups = [
      {
        filters: [
          {
            propertyName: TEAM_CONFIGS[mode].statusProperty,
            operator: FilterOperatorEnum.In,
            values: [...CANDIDATE_STATUSES[mode]],
          },
          ...commonFilters,
        ],
      },
    ];
  }

  const team = signalTeamForMode(mode);
  const properties = [
    "dealname",
    "address_line_1",
    "project_number",
    "pb_location",
    TEAM_CONFIGS[team].statusProperty,
    ...(mode === "inspection" ? [TEAM_CONFIGS.permit.statusProperty] : []),
    ...SCAN_IDENTIFIER_PROPERTIES[mode],
  ];

  const response = await searchWithRetry({
    filterGroups,
    properties,
    limit: CHUNK_SIZE,
    // Bare property name sorts ascending — stable rotation order.
    sorts: ["hs_object_id"],
  } as unknown as Parameters<typeof searchWithRetry>[0]);

  return ((response.results ?? []) as Array<{
    id: string;
    properties?: Record<string, string | null>;
  }>).map((d) => ({ id: d.id, properties: d.properties ?? {} }));
}

export async function GET(request: NextRequest) {
  // Shadow-mode gate — 404 (not 403) so the route is invisible while dark.
  if (process.env.APPROVAL_SCAN_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json(
      { status: "error", error: "Database not configured" },
      { status: 500 },
    );
  }

  try {
    const watermarkRow = await prisma.systemConfig.findUnique({
      where: { key: WATERMARK_KEY },
    });
    const watermark = parseWatermark(watermarkRow?.value);

    // Keep the RAW page for pagination — exhaustion and the cursor must be
    // computed pre-filter, or a full page that filters below CHUNK_SIZE would
    // falsely rotate the mode and reset the cursor, starving later ids.
    const rawDeals = await fetchCandidates(watermark.mode, watermark.after);
    let deals = rawDeals;
    // Inspection: the OR'd HubSpot groups over-match (deals appear in both);
    // re-check the candidate rule per deal.
    if (watermark.mode === "inspection") {
      deals = rawDeals.filter((d) =>
        isInspectionCandidate(
          d.properties[TEAM_CONFIGS.permit.statusProperty],
          d.properties[TEAM_CONFIGS.pto.statusProperty],
        ),
      );
    }

    const team = signalTeamForMode(watermark.mode);
    const existingRows = deals.length
      ? await prisma.approvalSignal.findMany({
          where: { hubspotDealId: { in: deals.map((d) => d.id) }, team },
        })
      : [];
    const existing: ExistingSignalRow[] = existingRows.map((r) => ({
      hubspotDealId: r.hubspotDealId,
      signalType: r.signalType as SignalType,
      status: r.status as SignalStatus,
      dismissedMessageIds: r.dismissedMessageIds,
      evidenceMessageId:
        (r.evidence as { messageId?: string } | null)?.messageId ?? null,
    }));

    const db = prisma;
    const deps = liveScanDeps(async (messageId) => {
      const row = await db.approvalScanVerdict.findUnique({
        where: { messageId },
      });
      return row
        ? {
            verdict: row.verdict as ApprovalVerdict,
            confidence: row.confidence as VerdictConfidence,
            quote: row.quote,
          }
        : null;
    });

    // Per-deal scan with a wall-clock budget: a whole-page scan (Gmail
    // searches + LLM calls for 25 deals) can exceed maxDuration and 504,
    // which used to lose the verdict cache and watermark — every retry then
    // restarted from zero. Each raw deal now persists its own signals and
    // verdicts, and the watermark advances to the last deal actually
    // processed, so a timeout costs at most one deal of work.
    const BUDGET_MS = 75_000;
    const startedAt = Date.now();
    const scannable = new Set(deals.map((d) => d.id));
    const allSignals: Awaited<
      ReturnType<typeof scanApprovalSignals>
    >["signals"] = [];
    let verdictsCached = 0;
    let dealsScanned = 0;
    let lastProcessedId: string | null = null;
    let ranOutOfBudget = false;
    const allErrors: string[] = [];

    for (const raw of rawDeals) {
      if (Date.now() - startedAt > BUDGET_MS) {
        ranOutOfBudget = true;
        break;
      }
      if (scannable.has(raw.id)) {
        const dealResult = await scanApprovalSignals({
          mode: watermark.mode,
          deals: [raw],
          existing: existing.filter((e) => e.hubspotDealId === raw.id),
          deps,
        });
        allSignals.push(...dealResult.signals);
        allErrors.push(...dealResult.errors);
        if (dealResult.verdicts.length > 0) {
          await prisma.approvalScanVerdict.createMany({
            data: dealResult.verdicts,
            skipDuplicates: true,
          });
          verdictsCached += dealResult.verdicts.length;
        }
        dealsScanned++;
      }
      // Filter-skipped deals still advance the cursor — they need no scan.
      lastProcessedId = raw.id;
    }
    const result = { signals: allSignals };

    // Persist signals — three-strikes actions were computed against the rows
    // read above, but a user can dismiss/mute a row WHILE the (minutes-long)
    // scan loop runs, so the write is guarded rather than an unconditional
    // upsert: it never clobbers a MUTED row or re-opens a row whose current
    // evidence messageId was dismissed mid-scan.
    let created = 0;
    let refreshed = 0;
    let reopened = 0;
    let skippedConcurrent = 0;
    for (const signal of result.signals) {
      const evidence = JSON.parse(JSON.stringify(signal.evidence)) as object;
      const shared = {
        actualStatus: signal.actualStatus,
        proposedStatus: signal.proposedStatus,
        confidence: signal.confidence,
        evidence,
        detectedAt: new Date(),
        status: "OPEN" as const,
      };
      const key = {
        hubspotDealId: signal.hubspotDealId,
        team: signal.team,
        signalType: signal.signalType,
      };
      const updated = await prisma.approvalSignal.updateMany({
        where: {
          ...key,
          status: { not: "MUTED" },
          NOT: { dismissedMessageIds: { has: signal.evidence.messageId } },
        },
        data: {
          ...shared,
          // New evidence reopens RESOLVED/DISMISSED (MUTED is excluded above).
          resolvedAt: null,
          resolvedBy: null,
        },
      });
      if (updated.count === 0) {
        // Either no row exists yet, or a concurrent dismissal/mute made the
        // guard miss. Re-read FRESH (not the pre-loop snapshot) to tell them
        // apart — only a genuinely absent row is created.
        const freshRow = await prisma.approvalSignal.findUnique({
          where: { hubspotDealId_team_signalType: key },
        });
        if (freshRow) {
          skippedConcurrent++;
          continue;
        }
        await prisma.approvalSignal.create({ data: { ...key, ...shared } });
      }
      if (signal.action === "create") created++;
      else if (signal.action === "refresh") refreshed++;
      else reopened++;
    }

    // Advance the rotating watermark. Exhaustion means the whole RAW page was
    // processed AND the page was short (cursor from the raw page so
    // filtered-out deals still advance). A budget cutoff resumes from the
    // last processed deal instead of rotating.
    const exhausted = !ranOutOfBudget && rawDeals.length < CHUNK_SIZE;
    const next: Watermark = exhausted
      ? { mode: nextMode(watermark.mode), after: "0" }
      : {
          mode: watermark.mode,
          after: lastProcessedId ?? watermark.after,
        };
    await prisma.systemConfig.upsert({
      where: { key: WATERMARK_KEY },
      create: { key: WATERMARK_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });

    if (allErrors.length > 0) {
      console.warn("[approval-scan] partial errors:", allErrors);
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      mode: watermark.mode,
      nextWatermark: next,
      ranOutOfBudget,
      dealsScanned,
      created,
      refreshed,
      reopened,
      skippedConcurrent,
      verdictsCached,
      errors: allErrors,
    });
  } catch (err) {
    console.error("[approval-scan] failed:", err);
    Sentry.captureException(err);
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
