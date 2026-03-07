"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * SolarIframeBridge
 *
 * Renders the Solar Surveyor iframe and acts as a postMessage bridge
 * for auth + API calls. Required because cross-site cookies between
 * solarsurveyor.vercel.app and pbtechops.com are blocked in iframe context.
 *
 * The parent page (pbtechops.com) IS authenticated — its same-origin
 * fetch() calls to /api/solar/* include cookies. This component relays
 * those calls on behalf of the iframe.
 *
 * Protocol:
 *   iframe → parent: { type: 'SOLAR_API_REQUEST', id, path, method, body, headers }
 *   parent → iframe: { type: 'SOLAR_API_RESPONSE', id, status, data, headers }
 *   parent → iframe: { type: 'SOLAR_SESSION', user }  (on load)
 */

const ALLOWED_IFRAME_ORIGINS = [
  "https://solarsurveyor.vercel.app",
  "http://localhost:5173",
];

interface SolarIframeBridgeProps {
  iframeSrc: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: string;
  };
}

export default function SolarIframeBridge({ iframeSrc, user }: SolarIframeBridgeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send session to iframe after it loads
  const sendSession = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage(
      { type: "SOLAR_SESSION", user },
      iframeSrc,
    );
  }, [user, iframeSrc]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Validate origin
      if (!ALLOWED_IFRAME_ORIGINS.includes(event.origin)) return;

      const { type, id, path, method, body, headers } = event.data || {};

      if (type === "SOLAR_SESSION_REQUEST") {
        // Iframe requesting session — reply immediately
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        iframe.contentWindow.postMessage(
          { type: "SOLAR_SESSION", user },
          event.origin,
        );
        return;
      }

      if (type === "SOLAR_API_REQUEST" && id && path) {
        // Relay API request — same-origin fetch (cookies included automatically)
        relayApiRequest(event.origin, id, path, method, body, headers);
      }
    }

    async function relayApiRequest(
      origin: string,
      requestId: string,
      path: string,
      method: string = "GET",
      body?: string,
      reqHeaders?: Record<string, string>,
    ) {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      // Only allow /api/solar/* paths
      if (!path.startsWith("/api/solar")) {
        iframe.contentWindow.postMessage(
          { type: "SOLAR_API_RESPONSE", id: requestId, status: 403, data: { error: "Forbidden path" } },
          origin,
        );
        return;
      }

      try {
        const fetchHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...reqHeaders,
        };

        const fetchOptions: RequestInit = {
          method: method.toUpperCase(),
          headers: fetchHeaders,
          credentials: "include",
        };

        if (body && method.toUpperCase() !== "GET") {
          fetchOptions.body = body;
        }

        const response = await fetch(path, fetchOptions);
        const contentType = response.headers.get("content-type") || "";
        let data = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        // Extract relevant response headers
        const respHeaders: Record<string, string> = {};
        const csrfCookie = response.headers.get("set-cookie");
        if (csrfCookie) {
          // Extract csrf_token value for the iframe
          const match = csrfCookie.match(/csrf_token=([^;]*)/);
          if (match) {
            respHeaders["x-csrf-token"] = decodeURIComponent(match[1]);
          }
        }

        iframe.contentWindow.postMessage(
          { type: "SOLAR_API_RESPONSE", id: requestId, status: response.status, data, headers: respHeaders },
          origin,
        );
      } catch (err) {
        iframe.contentWindow.postMessage(
          { type: "SOLAR_API_RESPONSE", id: requestId, status: 500, data: { error: String(err) } },
          origin,
        );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [user]);

  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      className="flex-1 w-full border-none"
      title="Solar Surveyor"
      allow="clipboard-read; clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      onLoad={sendSession}
    />
  );
}
