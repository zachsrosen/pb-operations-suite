/**
 * Action: Generic HTTP request.
 *
 * Lets admins POST/PUT/GET to arbitrary URLs. Useful for:
 *  - Integrating with tools that don't have a dedicated action yet
 *  - Webhooks to external systems (Zapier, IFTTT, custom endpoints)
 *  - REST API calls to internal services
 *
 * Security:
 *  - ADMIN role required to save/edit the workflow (already gated)
 *  - Optional allowlist via ADMIN_WORKFLOWS_HTTP_ALLOWLIST env var
 *    (comma-separated hostnames). When unset, all hosts are allowed.
 *  - No auth cookies/headers are forwarded — this is a clean outgoing request
 *  - Response body is truncated to 10KB to avoid bloating run result storage
 *  - 10 second timeout to prevent hung requests
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.string().optional().default(""), // JSON object string
  body: z.string().optional().default(""),    // raw string body
});

const MAX_RESPONSE_SIZE = 10_000;
const TIMEOUT_MS = 10_000;

function isHostAllowed(url: string): boolean {
  const allowlist = process.env.ADMIN_WORKFLOWS_HTTP_ALLOWLIST;
  if (!allowlist || !allowlist.trim()) return true; // unset = allow all
  const allowed = allowlist.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((a) => hostname === a || hostname.endsWith(`.${a}`));
}

export const httpRequestAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { status: number; body: string; truncated: boolean }
> = {
  kind: "http-request",
  name: "HTTP request",
  description:
    "GET/POST/PUT/PATCH/DELETE to a URL. Response body available to later steps via {{previous.stepId.body}}.",
  category: "Integration",
  fields: [
    { key: "url", label: "URL", kind: "text", placeholder: "https://example.com/webhook", required: true },
    { key: "method", label: "Method", kind: "text", placeholder: "GET | POST | PUT | PATCH | DELETE" },
    {
      key: "headers",
      label: "Headers (JSON, optional)",
      kind: "textarea",
      placeholder: `{"Authorization": "Bearer xxx", "Content-Type": "application/json"}`,
    },
    {
      key: "body",
      label: "Body (optional)",
      kind: "textarea",
      help: "Raw string. For JSON, include Content-Type header + pass a JSON-encoded string here.",
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    if (!isHostAllowed(inputs.url)) {
      throw new Error(
        `HTTP request blocked: ${inputs.url} is not in ADMIN_WORKFLOWS_HTTP_ALLOWLIST`,
      );
    }

    let headers: Record<string, string> = {};
    if (inputs.headers && inputs.headers.trim()) {
      try {
        const parsed: unknown = JSON.parse(inputs.headers);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") headers[k] = v;
          }
        } else {
          throw new Error("headers must be a JSON object");
        }
      } catch (e) {
        throw new Error(`Invalid headers JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(inputs.url, {
        method: inputs.method ?? "GET",
        headers,
        body: inputs.method === "GET" || inputs.method === "DELETE" ? undefined : (inputs.body || undefined),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text().catch(() => "");
    const truncated = text.length > MAX_RESPONSE_SIZE;
    const body = truncated ? text.slice(0, MAX_RESPONSE_SIZE) : text;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    return { status: res.status, body, truncated };
  },
};
