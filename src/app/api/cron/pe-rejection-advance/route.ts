import { NextRequest, NextResponse } from "next/server";
import { advancePeRejections, recordAdvanceLedger } from "@/lib/pe-rejection-advance";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pe-rejection-advance
 *
 * Poller (schedule in vercel.json). HubSpot can't re-enroll on tasks or trigger
 * on "all associated tasks complete", so this advances a deal's PE milestone
 * status from "Rejected" → "Ready to Resubmit" once all of that milestone's
 * rejection tasks are completed (and at least one existed). HubSpot-only; no PE
 * API calls. CRON_SECRET validated here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Auto-complete stale PE tasks (submit / rejection / resubmit) BEFORE advancing,
    // so a resubmission closes the rejection task and the advance step can flip the
    // milestone status in the same run. Flag-gated; convergent so a skipped run heals.
    let autocomplete: { completed: number; ledgerTotal?: number } | undefined;
    if (process.env.PE_TASK_AUTOCOMPLETE_ENABLED === "true") {
      try {
        const { autocompletePeTasks, recordAutocompleteLedger } = await import("@/lib/pe-task-autocomplete");
        const ac = await autocompletePeTasks();
        let acLedgerTotal: number | undefined;
        if (ac.completed.length > 0) {
          console.warn(
            "[pe-task-autocomplete] completed:",
            ac.completed
              .map((c) => `${c.dealName} ${c.kind}/${c.milestone}${c.team ? `/${c.team}` : ""}`)
              .join(" | "),
          );
          const acLedger = await recordAutocompleteLedger(ac.completed, new Date().toISOString());
          acLedgerTotal = acLedger.totalCompleted;
        }
        autocomplete = { completed: ac.completed.length, ledgerTotal: acLedgerTotal };
      } catch (err) {
        console.error("[pe-task-autocomplete] failed (non-fatal):", err);
      }
    }

    const result = await advancePeRejections();
    // Persist a durable running tally (survives log retention) so the total
    // auto-advanced is auditable any time. Only touch the row when something
    // actually advanced, to avoid a needless write every hour.
    let ledgerTotal: number | undefined;
    if (result.advanced.length > 0) {
      console.warn(
        "[pe-rejection-advance] advanced:",
        result.advanced.map((a) => `${a.dealName} ${JSON.stringify(a.changes)}`).join(" | "),
      );
      const ledger = await recordAdvanceLedger(result.advanced, new Date().toISOString());
      ledgerTotal = ledger.totalAdvanced;
    }
    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      advanced: result.advanced.length,
      ledgerTotal,
      deals: result.advanced,
      autocomplete,
    });
  } catch (err) {
    console.error("[pe-rejection-advance] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
