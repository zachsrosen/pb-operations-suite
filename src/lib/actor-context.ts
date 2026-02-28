/**
 * Actor Context
 *
 * Provides a unified identity contract for audit logging across both
 * HTTP API routes (user-initiated) and background pipelines (automated).
 *
 * Routes build ActorContext from requireApiAuth(). Pipelines use PIPELINE_ACTOR.
 */

export interface ActorContext {
  email: string;
  name?: string;
  ipAddress?: string;
  userAgent?: string;
  requestPath?: string;
  requestMethod?: string;
}

/** Default actor for automated pipeline runs (no HTTP request). */
export const PIPELINE_ACTOR: ActorContext = {
  email: "pipeline@system",
  name: "BOM Pipeline",
  requestPath: "bom-pipeline",
  requestMethod: "INTERNAL",
};
