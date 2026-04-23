/**
 * Inngest sync helper.
 *
 * Tells Inngest Cloud to re-read our /api/inngest endpoint so newly
 * added/removed functions get registered. Called automatically by the
 * Vercel deployment webhook on deployment.succeeded, and exposed as a
 * standalone endpoint for manual / CI triggering.
 *
 * Background: the Vercel-Inngest integration attempts auto-sync but
 * targets the deployment-specific URL (behind Vercel auth) which fails.
 * We sync against the canonical public URL instead.
 */

const SYNC_URL = "https://api.inngest.com/fn/register";

export interface InngestSyncResult {
  ok: boolean;
  status: number;
  body: string;
  skippedReason?: string;
}

/**
 * Trigger an Inngest sync. Returns the HTTP status + body for logging.
 * Never throws — caller is expected to log/alert on non-200.
 */
export async function triggerInngestSync(): Promise<InngestSyncResult> {
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  if (!signingKey) {
    return {
      ok: false,
      status: 0,
      body: "",
      skippedReason: "INNGEST_SIGNING_KEY not configured",
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_URL ?? "https://www.pbtechops.com";
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/inngest`;

  try {
    const res = await fetch(SYNC_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${signingKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: endpoint }),
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
