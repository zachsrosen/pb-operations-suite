import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { runPeAudit, type AuditEvent } from "@/lib/pe-audit-orchestrator";
import type { Milestone } from "@/lib/pe-turnover";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
