/**
 * Inngest serve handler — exposes GET/POST/PUT on /api/inngest.
 *
 * Inngest Cloud calls this endpoint to register and invoke functions.
 * Authentication is handled by Inngest's signing-key verification inside
 * the serve handler — this route is listed in PUBLIC_API_ROUTES to skip
 * session-based auth, same pattern as the HubSpot webhook routes.
 *
 * maxDuration = 300 matches the BOM pipeline's existing ceiling. When the
 * pipeline is split into per-stage step.run() calls, each step gets its
 * own 300s budget.
 */

import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest-client";
import { bomDesignCompletePipeline } from "@/inngest/functions/bom-design-complete";
import { adminWorkflowExecutor } from "@/inngest/functions/admin-workflow-executor";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [bomDesignCompletePipeline, adminWorkflowExecutor],
});
