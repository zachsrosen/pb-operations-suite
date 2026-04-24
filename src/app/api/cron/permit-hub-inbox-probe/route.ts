import { NextRequest, NextResponse } from "next/server";
import {
  buildGmailThreadQuery,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
} from "@/lib/gmail-shared-inbox";

/**
 * GET /api/cron/permit-hub-inbox-probe?team=permit&region=co&address=6323+Galeta+Dr
 *
 * One-shot diagnostic to verify the shared-inbox correspondence feature.
 * Unlike /api/permit-hub/debug/inbox (admin-session-gated), this is
 * CRON_SECRET-gated so operators and me-via-curl can hit it directly.
 *
 * Does NOT return raw email content — only subjects, senders, and dates
 * of matched threads, so it's safe to log to shared channels.
 *
 * Intended for one-off verification; not on a cron schedule.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const team = (url.searchParams.get("team") ?? "permit") as "permit" | "ic";
  const region = (url.searchParams.get("region") ?? "co") as "co" | "ca";
  const ahjEmail = url.searchParams.get("ahjEmail");
  const address = url.searchParams.get("address");
  const lookback = Number(url.searchParams.get("lookbackDays") ?? "90");

  const mailbox = getSharedInboxAddress(team, region);
  const envReport = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:
      !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    PERMIT_INBOX_CO: !!process.env.PERMIT_INBOX_CO,
    PERMIT_INBOX_CA: !!process.env.PERMIT_INBOX_CA,
    IC_INBOX_CO: !!process.env.IC_INBOX_CO,
    IC_INBOX_CA: !!process.env.IC_INBOX_CA,
  };

  if (!mailbox) {
    return NextResponse.json({
      ok: false,
      step: "getSharedInboxAddress",
      reason: `No mailbox configured for team=${team} region=${region}`,
      envReport,
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
    envReport,
    hint:
      threads.length === 0
        ? "Check Vercel runtime logs filtered to '[gmail-shared-inbox]' for the actual failure reason (scope, impersonation, or just no matches)."
        : undefined,
  });
}
