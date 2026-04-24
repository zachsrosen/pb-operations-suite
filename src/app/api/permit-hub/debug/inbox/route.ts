import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  buildGmailThreadQuery,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
} from "@/lib/gmail-shared-inbox";
import { isPermitHubAllowedRole, isPermitHubEnabled } from "@/lib/permit-hub";

/**
 * GET /api/permit-hub/debug/inbox?region=co|ca&ahjEmail=x@y.com&address=123+Main+St
 *
 * Diagnostic endpoint for the shared-inbox correspondence feature.
 * Returns:
 *   • the effective mailbox address for the region
 *   • the Gmail search query that would be used
 *   • whether threads were found (count + first 10)
 *
 * Silent failures in the production path get surfaced here via the
 * new getReadonlyTokenVerbose logging — check Vercel runtime logs
 * when this endpoint returns an empty list.
 *
 * Gated on PERMIT_HUB_ENABLED + allowed role (admin/exec/permit/tech_ops).
 */
export async function GET(req: NextRequest) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const region = (url.searchParams.get("region") ?? "co") as "co" | "ca";
  const team = (url.searchParams.get("team") ?? "permit") as "permit" | "ic";
  const ahjEmail = url.searchParams.get("ahjEmail");
  const address = url.searchParams.get("address");
  const lookback = Number(url.searchParams.get("lookbackDays") ?? "90");

  const mailbox = getSharedInboxAddress(team, region);
  if (!mailbox) {
    return NextResponse.json({
      ok: false,
      step: "getSharedInboxAddress",
      reason: `No mailbox configured for team=${team} region=${region} (missing env var)`,
      team,
      region,
    });
  }

  const query = buildGmailThreadQuery({
    ahjEmail,
    address,
    lookbackDays: lookback,
  });

  const threads = await fetchSharedInboxThreads({
    mailbox,
    query,
    maxThreads: 10,
  });

  return NextResponse.json({
    ok: true,
    team,
    region,
    mailbox,
    query,
    threadCount: threads.length,
    threads: threads.slice(0, 10).map((t) => ({
      id: t.id,
      subject: t.subject,
      from: t.from ?? t.fromEmail,
      date: t.date,
    })),
    hint:
      threads.length === 0
        ? "Check Vercel runtime logs for [gmail-shared-inbox] errors. If no errors logged, the query genuinely matched 0 threads — try broadening ahjEmail/address or extending lookbackDays."
        : undefined,
  });
}
