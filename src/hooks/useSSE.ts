"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseSSEOptions {
  /** URL of the SSE endpoint */
  url?: string;
  /** Maximum reconnection attempts before giving up */
  maxRetries?: number;
  /** Cache key prefix to filter updates */
  cacheKeyFilter?: string;
}

interface UseSSEReturn {
  connected: boolean;
  reconnecting: boolean;
}

/**
 * SSE (Server-Sent Events) hook with exponential backoff reconnection.
 * Extracted from page.tsx and enhanced with connection state tracking.
 */
export function useSSE(
  onUpdate: () => void,
  options: UseSSEOptions = {}
): UseSSEReturn {
  const {
    url = "/api/stream",
    maxRetries = 10,
    cacheKeyFilter = "projects",
  } = options;

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  const connectRef = useRef<() => void>(undefined);

  // Keep onUpdate ref current without re-triggering effect
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      retriesRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (
          data.type === "cache_update" &&
          data.key?.startsWith(cacheKeyFilter)
        ) {
          onUpdateRef.current();
        }

        if (data.type === "reconnect") {
          es.close();
          setConnected(false);
          setReconnecting(true);
          // Server asked us to reconnect - use short delay
          if (connectRef.current) {
            setTimeout(connectRef.current, 1000);
          }
        }
      } catch {
        // Ignore parse errors (heartbeats etc.)
      }
    };

    es.onerror = () => {
      es.close();
      setConnected(false);

      if (retriesRef.current < maxRetries) {
        setReconnecting(true);
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(
          1000 * Math.pow(2, retriesRef.current),
          30000
        );
        retriesRef.current++;
        if (connectRef.current) {
          setTimeout(connectRef.current, delay);
        }
      } else {
        setReconnecting(false);
      }
    };
  }, [url, maxRetries, cacheKeyFilter]);

  // Store the connect function in a ref so it can be called from within its own callbacks
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { connected, reconnecting };
}
