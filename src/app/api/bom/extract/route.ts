/**
 * BOM Extract API
 *
 * POST /api/bom/extract
 *   Accepts a JSON body with either a Vercel Blob URL or a Google Drive URL.
 *   Downloads the planset PDF, then delegates to the shared extractBomFromPdf()
 *   function (src/lib/bom-extract.ts) for Anthropic Files API upload + Claude
 *   extraction. Returns structured BOM JSON as SSE stream events.
 *
 * Body (application/json):
 *   { blobUrl: "https://..." }          ← Vercel Blob upload
 *   { driveUrl: "...", fileId: "..." }  ← Google Drive link
 *
 * Auth required: design/ops roles
 *
 * SSE Events:
 *   { type: "progress", step: string, message: string }
 *   { type: "result", bom: object }
 *   { type: "error", error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";
import { logActivity } from "@/lib/db";
import { extractBomFromPdf } from "@/lib/bom-extract";
import { getToken } from "next-auth/jwt";
import type { ActorContext } from "@/lib/actor-context";

// ── Auth ──────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
  "PERMITTING",
]);

// ── Route config ─────────────────────────────────────────────────────────────

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

// ── Drive token helpers ──────────────────────────────────────────────────────

async function refreshUserToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

function isHttpsRequest(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

async function getJwtToken(request: NextRequest): Promise<Record<string, unknown> | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const secureFirst = isHttpsRequest(request);
  const attempts = secureFirst ? [true, false] : [false, true];

  for (const secureCookie of attempts) {
    try {
      const token = await getToken({ req: request, secret, secureCookie });
      if (token && typeof token === "object") {
        return token as Record<string, unknown>;
      }
    } catch {
      // try next cookie mode
    }
  }

  return null;
}

async function getDriveToken(request: NextRequest): Promise<{ token: string; tokenSource: string }> {
  try {
    const jwtToken = await getJwtToken(request);
    const accessToken = jwtToken?.accessToken as string | undefined;
    const expires = jwtToken?.accessTokenExpires as number | undefined;
    const refreshToken = jwtToken?.refreshToken as string | undefined;

    if (accessToken && (expires == null || Date.now() < expires - 60_000)) {
      return { token: accessToken, tokenSource: "user_oauth" };
    }

    if (refreshToken) {
      const refreshed = await refreshUserToken(refreshToken);
      if (refreshed) {
        return { token: refreshed, tokenSource: "user_oauth_refreshed" };
      }
    }
  } catch {
    // fall through
  }

  // CLI/machine access: use stored OAuth refresh token if available
  const envRefreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (envRefreshToken) {
    const refreshed = await refreshUserToken(envRefreshToken);
    if (refreshed) {
      return { token: refreshed, tokenSource: "env_refresh_token" };
    }
  }

  // Try service account with domain-wide delegation
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      const saTokenDwd = await getServiceAccountToken(
        ["https://www.googleapis.com/auth/drive.readonly"],
        impersonateEmail
      );
      return { token: saTokenDwd, tokenSource: "service_account_dwd" };
    } catch {
      // DWD not configured — fall through to plain SA
    }
  }

  const saToken = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
  return { token: saToken, tokenSource: "service_account" };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // ── API key ────────────────────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  let body: { blobUrl?: string; driveUrl?: string; fileId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.blobUrl && !body.driveUrl && !body.fileId) {
    return NextResponse.json({ error: "blobUrl, driveUrl, or fileId is required" }, { status: 400 });
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  const sourceRef: string | null = body.fileId ?? body.blobUrl ?? body.driveUrl ?? null;

  const actor: ActorContext = {
    email: authResult.email,
    name: authResult.name,
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/extract",
    requestMethod: "POST",
  };

  const MAX_SIZE = 500 * 1024 * 1024;

  // ── Stream ─────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed (client disconnected)
        }
      };

      try {
        // ── Stage 1: Download PDF ──────────────────────────────────────────
        const downloadMsg = body.fileId
          ? "Downloading PDF from Google Drive…"
          : body.blobUrl
            ? "Fetching uploaded PDF…"
            : "Downloading PDF…";
        send({ type: "progress", step: "downloading", message: downloadMsg });

        let fetchRes: Response;
        try {
          if (body.fileId) {
            const { token } = await getDriveToken(req);
            const driveMediaUrl =
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.fileId)}` +
              `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;

            fetchRes = await fetch(driveMediaUrl, {
              redirect: "follow",
              headers: { Authorization: `Bearer ${token}` },
            });

            if (!fetchRes.ok) {
              const driveErr = await fetchRes.json().catch(() => ({})) as { error?: { message?: string } };
              const msg = driveErr.error?.message ?? `HTTP ${fetchRes.status}`;
              send({ type: "error", error: `Failed to download Drive file (${msg})` });
              return;
            }
          } else {
            const sourceUrl = body.blobUrl ?? body.driveUrl!;
            const fetchHeaders: Record<string, string> = {};
            if (body.blobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
              fetchHeaders["authorization"] = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
            }
            fetchRes = await fetch(sourceUrl, { redirect: "follow", headers: fetchHeaders });
            if (!fetchRes.ok) {
              send({
                type: "error",
                error: body.blobUrl
                  ? `Failed to read uploaded file (HTTP ${fetchRes.status})`
                  : `Failed to download from Drive (HTTP ${fetchRes.status}). Make sure the file is shared publicly.`,
              });
              return;
            }
          }
        } catch (e) {
          send({ type: "error", error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }

        const fetchContentType = fetchRes.headers.get("content-type") ?? "";
        if (!fetchContentType.includes("pdf") && !fetchContentType.includes("octet-stream")) {
          if (!body.blobUrl && !body.fileId) {
            send({ type: "error", error: "Drive URL did not return a PDF. The file may require confirmation — try downloading it and using Upload PDF instead." });
            return;
          }
        }

        const arrayBuffer = await fetchRes.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_SIZE) {
          send({ type: "error", error: "PDF exceeds 500MB limit" });
          return;
        }

        const filename = body.blobUrl
          ? (body.blobUrl.split("/").pop() ?? "planset.pdf")
          : `drive-${body.fileId ?? "planset"}.pdf`;

        const pdfBuffer = Buffer.from(arrayBuffer);

        // ── Stage 2 + 3: Extract BOM (delegated to shared function) ──────
        const result = await extractBomFromPdf(
          pdfBuffer,
          filename,
          actor,
          (progress) => send({ type: "progress", ...progress }),
        );

        send({ type: "result", bom: result.bom });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Internal server error";
        console.error("[bom/extract] Stream error:", msg, e);
        await logActivity({
          type: "API_ERROR",
          description: `BOM extraction failed: ${msg}`,
          userEmail: authResult.email,
          userName: authResult.name,
          entityType: "bom",
          entityId: sourceRef || undefined,
          entityName: "extract",
          metadata: { event: "bom_extract", outcome: "failed", error: msg },
          ipAddress: authResult.ip,
          userAgent: authResult.userAgent,
          requestPath: "/api/bom/extract",
          requestMethod: "POST",
          responseStatus: 500,
          durationMs: Date.now() - startedAt,
        }).catch(() => {});
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
