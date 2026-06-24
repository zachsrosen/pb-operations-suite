import { NextRequest, NextResponse } from "next/server";
import { syncFromPeApi } from "@/lib/pe-api-sync";
import { syncMilestonePaidFromInvoices } from "@/lib/pe-invoice-paid-sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pe-api-sync
 *
 * Hourly PE Paddock API sync (schedule in vercel.json). Re-enabled
 * 2026-06-12 after Raceway added native doc `status` + `versions[]`
 * (with uploadedBy attribution) to the documents object.
 *
 * Writes:
 *   - PeDocVersion — full upload history, every run
 *   - PeDocumentReview — doc statuses; scrape-written rows stay protected
 *     unless PE_API_STATUS_AUTHORITY=true (full scrape cutover)
 *   - PeDocChangeLog — status transitions (syncedBy "pe-api-sync")
 *   - PeActionItem — reviewer action items
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Full sync (not incremental): the PE API's `since` filter keys on project
    // updatedAt, which a document upload often does NOT bump — so an incremental
    // run fetches 0 projects and silently misses new docs. A full pass is only
    // ~84s for ~388 projects (well under maxDuration) and reliably catches every
    // upload. The manual "Sync now" button remains for instant refreshes.
    const result = await syncFromPeApi({ fullSync: true });

    // Invoice-driven Paid: advance Approved milestones → Paid (with the invoice's
    // actual paid-in-full date) where the PE invoice is paid. Best-effort; gated to
    // Approved deals and to PE_INVOICE_PAID_SYNC_ENABLED. Never fails the run.
    let invoicePaid: Awaited<ReturnType<typeof syncMilestonePaidFromInvoices>> | { error: string };
    try {
      invoicePaid = await syncMilestonePaidFromInvoices();
    } catch (err) {
      invoicePaid = { error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      projectsFetched: result.projectsFetched,
      projectsMatched: result.projectsMatched,
      docsUpserted: result.docsUpserted,
      versionsUpserted: result.versionsUpserted,
      actionItemsUpserted: result.actionItemsUpserted,
      incremental: result.incremental,
      errors: result.errors.length,
      durationMs: result.durationMs,
      invoicePaid,
    });
  } catch (err) {
    console.error("[cron/pe-api-sync] Sync failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
