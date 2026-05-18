import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runCrossReference } from "@/lib/pe-crossref";

export const maxDuration = 300; // Vercel max — typical run is 30-60s

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  const internalToken = request.headers.get("x-internal-token");
  const isInternal = internalToken && internalToken === process.env.API_SECRET_TOKEN;
  if (!session?.user?.email && !isInternal) {
    return new Response("Not authenticated", { status: 401 });
  }
  const { dealId } = await params;
  const body = (await request.json().catch(() => ({}))) as { triggeredBy?: string };

  const triggeredBy = isInternal
    ? (body.triggeredBy ?? "audit-completion")
    : `manual:${session?.user?.email ?? "unknown"}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send("started", { dealId, triggeredBy });
      try {
        const result = await runCrossReference({ dealId, triggeredBy });
        send("completed", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
