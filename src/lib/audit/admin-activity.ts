/**
 * Admin Activity Helper
 *
 * Wraps the full audit pipeline (session → risk → log → anomaly check)
 * into a single call for server-side admin mutation routes.
 *
 * These routes (user role changes, permission updates, settings changes)
 * don't go through the frontend /api/activity/log endpoint, so they
 * need their own entry point into the audit system.
 */

import { logActivity, prisma, getUserByEmail } from "@/lib/db";
import type { ActivityType } from "@/lib/db";
import { getOrCreateAuditSession, runSessionAnomalyChecks } from "./session";
import { getActivityRiskLevel } from "./detect";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminActivityInput {
  /** Activity type from the ActivityType enum (e.g. USER_ROLE_CHANGED) */
  type: ActivityType;
  /** Human-readable description of what happened */
  description: string;
  /** The admin user performing the action (userId optional — resolved from email if missing) */
  userId?: string;
  userEmail: string;
  userName?: string;
  /** The entity being acted upon */
  entityType?: string;
  entityId?: string;
  entityName?: string;
  /** Arbitrary metadata for the activity log */
  metadata?: Record<string, unknown>;
  /** Request context for session resolution */
  ipAddress: string;
  userAgent: string | null;
  /** Optional explicit client type header */
  xClientType?: string | null;
  /** Forensic context: the API route path and HTTP method */
  requestPath?: string;
  requestMethod?: string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Log an admin mutation through the full audit pipeline.
 *
 * 1. Resolves (or creates) an audit session for the admin user
 * 2. Computes the activity's risk level from the risk map
 * 3. Writes the activity log row with session + risk fields
 * 4. Fires anomaly checks (non-blocking)
 *
 * Errors are caught and logged — never throws to the caller so admin
 * operations aren't blocked by audit failures.
 */
export async function logAdminActivity(input: AdminActivityInput): Promise<void> {
  try {
    if (!prisma) return;

    // Resolve userId if not provided (routes using requireApiAuth may not have it)
    let userId = input.userId || null;
    if (!userId && input.userEmail && input.userEmail !== "api@system") {
      const user = await getUserByEmail(input.userEmail);
      userId = user?.id || null;
    }

    // Step 1: Resolve audit session
    const { sessionId: auditSessionId, sessionData } =
      await getOrCreateAuditSession(
        {
          userEmail: input.userEmail,
          userName: input.userName || null,
          userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          xClientType: input.xClientType || null,
          hasValidSession: input.userEmail !== "api@system",
        },
        prisma
      );

    // Step 2: Compute risk level for this activity type
    const { riskLevel, riskScore } = getActivityRiskLevel(input.type);

    // Step 3: Write the activity log with audit fields
    await logActivity({
      type: input.type,
      description: input.description,
      userId: userId || undefined,
      userEmail: input.userEmail,
      userName: input.userName,
      entityType: input.entityType,
      entityId: input.entityId,
      entityName: input.entityName,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent || undefined,
      requestPath: input.requestPath,
      requestMethod: input.requestMethod,
      auditSessionId: auditSessionId || undefined,
      riskLevel,
      riskScore,
    });

    // Step 4: Fire anomaly checks (non-blocking)
    if (sessionData) {
      runSessionAnomalyChecks(sessionData, riskScore, prisma).catch(
        (e: unknown) => console.error("[admin-activity] Anomaly check failed:", e)
      );
    }
  } catch (error) {
    // Never throw — admin operations must not fail due to audit issues
    console.error("[admin-activity] Failed to log admin activity:", error);
  }
}

// ---------------------------------------------------------------------------
// Request header extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract IP address and user agent from Next.js headers.
 * Convenience for admin routes that need to pass request context.
 */
export function extractRequestContext(headersList: Headers): {
  ipAddress: string;
  userAgent: string | null;
  xClientType: string | null;
} {
  const ipAddress =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    "unknown";
  const userAgent = headersList.get("user-agent");
  const xClientType = headersList.get("x-client-type");

  return { ipAddress, userAgent, xClientType };
}
