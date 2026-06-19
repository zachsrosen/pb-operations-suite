/**
 * GET /api/cron/eagleview-poll-orders
 *
 * Vercel cron — every 30 minutes. Safety net for missed FileDelivery webhooks.
 *
 * For each EagleViewOrder in ORDERED status (>5min old):
 *   - Skip if reportId is still placeholder ("pending:..."); placeOrder must
 *     have failed and been marked FAILED via that path
 *   - GET /v3/Report/GetReport — if Completed, call fetchAndStoreDeliverables
 *   - If still pending, leave alone for next tick
 *
 * Auth: Bearer CRON_SECRET (matches other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAndStoreDeliverables } from "@/lib/eagleview-pipeline";
import { defaultPipelineDeps } from "@/lib/eagleview-pipeline-deps";
import { classifyTerminalStatus } from "@/lib/eagleview";

export const maxDuration = 300;

const FIVE_MIN_MS = 5 * 60 * 1000;

interface PollResult {
  reportId: string;
  outcome: string;
  reason?: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - FIVE_MIN_MS);
  const candidates = await prisma.eagleViewOrder.findMany({
    where: {
      status: "ORDERED",
      orderedAt: { lt: cutoff },
      reportId: { not: { startsWith: "pending:" } },
    },
    orderBy: { orderedAt: "asc" },
    take: 50,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ checked: 0, results: [] as PollResult[] });
  }

  const deps = defaultPipelineDeps();
  const results: PollResult[] = [];

  for (const order of candidates) {
    try {
      const status = await deps.client.getReport(order.reportId);
      const display = (status.displayStatus ?? "").toLowerCase();

      const terminal = classifyTerminalStatus(status.displayStatus);

      if (display.includes("complet") || display.includes("delivered")) {
        const r = await fetchAndStoreDeliverables(deps, order.reportId);
        results.push({
          reportId: order.reportId,
          outcome: r.status,
          reason: r.reason,
        });
      } else if (terminal) {
        // Includes EagleView "Closed - Wrong House" / "Closed - Poor Images",
        // which previously fell through to PENDING and were re-polled forever.
        await prisma.eagleViewOrder.update({
          where: { id: order.id },
          data: {
            status: terminal,
            errorMessage: `EV status: ${status.displayStatus}`,
          },
        });
        await deps
          .stampStatus(
            { dealId: order.dealId, ticketId: order.ticketId ?? null },
            { status: terminal === "CANCELLED" ? "Cancelled" : "Failed" },
          )
          .catch((err) => console.warn("[eagleview-poll] stamp terminal failed", err));
        results.push({
          reportId: order.reportId,
          outcome: terminal,
          reason: status.displayStatus ?? "ev_terminal_status",
        });
      } else {
        results.push({
          reportId: order.reportId,
          outcome: "PENDING",
          reason: status.displayStatus ?? "still_in_progress",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[eagleview-poll] error", order.reportId, msg);
      results.push({ reportId: order.reportId, outcome: "ERROR", reason: msg });
    }
  }

  return NextResponse.json({ checked: candidates.length, results });
}
