import { appCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`)
      );

      // Subscribe to cache updates
      const unsubscribe = appCache.subscribe((key, timestamp) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "cache_update", key, timestamp, lastUpdated: new Date(timestamp).toISOString() })}\n\n`
            )
          );
        } catch {
          // Stream closed
          unsubscribe();
        }
      });

      // Heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", timestamp: Date.now() })}\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      // Auto-close after 5 minutes to prevent stale connections
      setTimeout(() => {
        cleanup();
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "reconnect", reason: "timeout" })}\n\n`)
          );
          controller.close();
        } catch {
          // Already closed
        }
      }, 5 * 60 * 1000);
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
