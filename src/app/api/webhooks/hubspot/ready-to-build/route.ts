/**
 * HubSpot Ready-to-Build Webhook — Alias for design-complete handler.
 *
 * POST /api/webhooks/hubspot/ready-to-build
 *
 * Some HubSpot workflows point to this URL instead of /design-complete.
 * Both routes use the same handler — the trigger type is determined by
 * PIPELINE_STAGE_CONFIG, not the route path.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export { POST } from "../design-complete/route";
