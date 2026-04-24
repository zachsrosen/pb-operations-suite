import { NextRequest, NextResponse } from "next/server";
import {
  buildGmailThreadQuery,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
  probeSharedInboxToken,
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

  // First: check whether we can even get a readonly token for this mailbox.
  // The thread-list step silently returns [] on failure; surfacing the
  // token-exchange error lets us distinguish "no matches" from "Google
  // said no" without scraping log viewers.
  const tokenResult = await probeSharedInboxToken(mailbox);
  if (!tokenResult.ok) {
    return NextResponse.json({
      ok: false,
      step: "probeSharedInboxToken",
      team,
      region,
      mailbox,
      tokenError: {
        reason: tokenResult.reason,
        status: tokenResult.status,
        body: tokenResult.body,
      },
      envReport,
      hint: inferHintFromTokenError(tokenResult.reason, tokenResult.body),
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
        ? "Token exchange succeeded, but the Gmail search returned nothing. This means either the query is too narrow, the mailbox is actually empty, or the service account was authorized for the wrong scope. Verify gmail.readonly is in the delegation scopes, then try a broader query."
        : undefined,
  });
}

/**
 * Translate the Google OAuth error shapes we care about into actionable
 * hints. The body comes back as URL-form or JSON depending on which
 * endpoint failed.
 */
function inferHintFromTokenError(
  reason: string,
  body?: string,
): string {
  const blob = `${reason} ${body ?? ""}`.toLowerCase();
  if (blob.includes("unauthorized_client") || blob.includes("client is unauthorized")) {
    return "Service account is not authorized to impersonate this mailbox OR the gmail.readonly scope is not listed in admin.google.com → Security → API controls → Domain-wide delegation. Add the scope to the existing client ID.";
  }
  if (blob.includes("invalid_grant") && blob.includes("account not found")) {
    return "The impersonated mailbox does not exist in Google Workspace. Verify the address is a real user account, not an alias or group.";
  }
  if (blob.includes("invalid_grant")) {
    return "JWT signature or claims invalid. Usually: service account key rotated, or impersonated email is not a Workspace user. Check GOOGLE_SERVICE_ACCOUNT_* env vars.";
  }
  if (blob.includes("access_denied")) {
    return "Google rejected the token grant. Most often: domain-wide delegation scope allowlist is missing gmail.readonly.";
  }
  return "Unknown token-exchange error — copy the `body` field into the Google OAuth docs for specific guidance.";
}
