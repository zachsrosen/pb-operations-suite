import { appCache } from "@/lib/cache";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        isClosed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      const enqueueMessage = (data: object) => {
        try {
          // Check if stream is still writable before enqueueing
          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        } catch {
          // Stream has been closed or errored
          cleanup();
        }
      };

      try {
        // Send initial connection message
        enqueueMessage({ type: "connected", timestamp: Date.now() });

        // Subscribe to cache updates
        unsubscribe = appCache.subscribe((key, timestamp) => {
          try {
            enqueueMessage({
              type: "cache_update",
              key,
              timestamp,
              lastUpdated: new Date(timestamp).toISOString(),
            });
          } catch {
            // Error during cache update handling
            cleanup();
          }
        });

        // Heartbeat every 30 seconds to keep connection alive
        heartbeat = setInterval(() => {
          try {
            enqueueMessage({ type: "heartbeat", timestamp: Date.now() });
          } catch {
            // Stream closed, cleanup
            cleanup();
          }
        }, 30000);

        // Auto-close after 5 minutes to prevent stale connections
        timeoutHandle = setTimeout(() => {
          try {
            enqueueMessage({
              type: "reconnect",
              reason: "timeout",
            });
            cleanup();
            controller.close();
          } catch {
            // Already closed
            cleanup();
          }
        }, 5 * 60 * 1000);
      } catch (setupError) {
        // Error during initial setup
        console.error("Error setting up SSE stream:", setupError);
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
