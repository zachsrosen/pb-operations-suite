import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireApiAuth } from "@/lib/api-auth";
import { runPeAudit, type AuditEvent } from "@/lib/pe-audit-orchestrator";
import { setDriveTokenOverride } from "@/lib/drive-plansets";
import type { Milestone } from "@/lib/pe-turnover";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function resolveUserDriveToken(req: NextRequest): Promise<string | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const secureModes = proto === "https" ? [true, false] : [false, true];

  for (const secureCookie of secureModes) {
    try {
      const token = await getToken({ req, secret, secureCookie });
      if (!token) continue;

      const accessToken = token.accessToken as string | undefined;
      const expires = token.accessTokenExpires as number | undefined;

      if (accessToken && (expires == null || Date.now() < expires - 60_000)) {
        return accessToken;
      }

      const refreshToken = token.refreshToken as string | undefined;
      if (refreshToken) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (clientId && clientSecret) {
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
          if (res.ok) {
            const data = await res.json() as { access_token?: string };
            if (data.access_token) return data.access_token;
          }
        }
      }
    } catch {
      // try next cookie mode
    }
  }

  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return new Response("PE File Prep is not enabled", { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const body = await req.json().catch(() => ({}));
  const milestone = (body.milestone as Milestone) || "m1";

  const userDriveToken = await resolveUserDriveToken(req);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AuditEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream may be closed
        }
      };

      const timeout = setTimeout(() => {
        send({ type: "error", data: { message: "Audit timed out after 5 minutes" } });
        controller.close();
      }, 5 * 60 * 1000);

      if (userDriveToken) {
        setDriveTokenOverride(userDriveToken);
      }

      try {
        await runPeAudit({
          dealId,
          milestone,
          triggeredBy: authResult.email,
          onEvent: send,
        });
      } catch (err) {
        send({
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        setDriveTokenOverride(null);
        clearTimeout(timeout);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
