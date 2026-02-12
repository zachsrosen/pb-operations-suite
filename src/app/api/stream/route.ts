import { appCache } from "@/lib/cache";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
const STREAM_TTL_MS = 50_000; // Close before Vercel's ~60s timeout and ask client to reconnect

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const encoder = new TextEncoder();
  let cleanupRef: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let closeScheduled = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (isClosed) return;
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
      cleanupRef = cleanup;

      const safeClose = () => {
        if (closeScheduled) return;
        closeScheduled = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
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
            safeClose();
          }
        });

        // Heartbeat every 30 seconds to keep connection alive
        heartbeat = setInterval(() => {
          try {
            enqueueMessage({ type: "heartbeat", timestamp: Date.now() });
          } catch {
            // Stream closed, cleanup
            safeClose();
          }
        }, 30000);

        // Auto-close before platform timeout; client reconnects automatically.
        timeoutHandle = setTimeout(() => {
          try {
            enqueueMessage({
              type: "reconnect",
              reason: "ttl",
            });
            safeClose();
          } catch {
            // Already closed
            safeClose();
          }
        }, STREAM_TTL_MS);
      } catch (setupError) {
        // Error during initial setup
        console.error("Error setting up SSE stream:", setupError);
        safeClose();
      }
    },
    cancel() {
      cleanupRef?.();
      cleanupRef = null;
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
