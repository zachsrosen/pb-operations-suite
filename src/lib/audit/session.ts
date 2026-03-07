/**
 * Audit session resolution with race-safe transaction logic.
 *
 * Types are defined as string literal unions matching the Prisma enums
 * so this module works without a generated Prisma client.
 */

import { detectEnvironment, detectClientType, isPrivateIP } from "./detect";
import { runAnomalyChecks } from "./anomaly-runner";

// ---------------------------------------------------------------------------
// Local type aliases (mirror Prisma enums)
// ---------------------------------------------------------------------------
type ClientType =
  | "BROWSER"
  | "CLAUDE_CODE"
  | "CODEX"
  | "API_CLIENT"
  | "UNKNOWN";
type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

// ---------------------------------------------------------------------------
// Shared session shape for anomaly runner (no Prisma import)
// ---------------------------------------------------------------------------
export interface AuditSessionLike {
  id: string;
  userId: string | null;
  userEmail: string | null;
  clientType: string;
  environment: string;
  ipAddress: string;
  deviceFingerprint: string | null;
  riskScore: number;
  anomalyReasons: string[];
  // Alert dedup fields — carried from session resolution to avoid
  // a redundant findUnique when checking alert eligibility.
  startedAt: Date;
  immediateAlertSentAt: Date | null;
  criticalAlertSentAt: Date | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// hashCode -- DJB2 string hash returning a 32-bit integer
// ---------------------------------------------------------------------------
export function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// resolveSessionMatch -- pure function
// ---------------------------------------------------------------------------
interface SessionCandidate {
  id: string;
  clientType: string;
  ipAddress: string;
  endedAt: Date | null;
  lastActiveAt: Date;
}

interface SessionMatchContext {
  clientType: string;
  ipAddress: string;
  now: Date;
}

export function resolveSessionMatch(
  candidate: SessionCandidate,
  ctx: SessionMatchContext
): "REUSE" | "NEW" {
  // Already ended
  if (candidate.endedAt !== null) return "NEW";

  // Client type changed
  if (candidate.clientType !== ctx.clientType) return "NEW";

  // IP changed
  if (candidate.ipAddress !== ctx.ipAddress) return "NEW";

  // Inactivity timeout exceeded
  const elapsed = ctx.now.getTime() - candidate.lastActiveAt.getTime();
  if (elapsed > SESSION_INACTIVITY_TIMEOUT_MS) return "NEW";

  return "REUSE";
}

// ---------------------------------------------------------------------------
// computeConfidence -- pure function
// ---------------------------------------------------------------------------
interface ConfidenceContext {
  clientType: string;
  hasFingerprint: boolean;
  ipAddress: string;
}

const MEDIUM_CLIENT_TYPES = new Set<string>([
  "BROWSER",
  "CLAUDE_CODE",
  "CODEX",
]);

export function computeConfidence(ctx: ConfidenceContext): ConfidenceLevel {
  // HIGH: BROWSER + fingerprint + public IP
  if (
    ctx.clientType === "BROWSER" &&
    ctx.hasFingerprint &&
    !isPrivateIP(ctx.ipAddress)
  ) {
    return "HIGH";
  }

  // MEDIUM: browser-like or known AI agent
  if (MEDIUM_CLIENT_TYPES.has(ctx.clientType)) {
    return "MEDIUM";
  }

  // LOW: everything else (API_CLIENT, UNKNOWN)
  return "LOW";
}

// ---------------------------------------------------------------------------
// getOrCreateAuditSession -- race-safe DB transaction
// ---------------------------------------------------------------------------
export interface GetOrCreateSessionInput {
  userEmail: string | null;
  userName: string | null;
  userId: string | null;
  ipAddress: string;
  userAgent: string | null;
  xClientType: string | null;
  hasValidSession: boolean;
  deviceFingerprint?: string | null;
  fingerprintVersion?: number | null;
}

interface SessionResult {
  sessionId: string;
  isNew: boolean;
  // Session data for anomaly context (null if prisma unavailable)
  sessionData: AuditSessionLike | null;
}

// Minimal Prisma-like type so we don't need the generated client
type PrismaLike = {
  $transaction: (
    fn: (tx: PrismaTransactionClient) => Promise<SessionResult>
  ) => Promise<SessionResult>;
};

type PrismaTransactionClient = {
  $executeRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  auditSession: {
    findFirst: (args: Record<string, unknown>) => Promise<(SessionCandidate & {
      userId?: string | null;
      userEmail?: string | null;
      environment?: string;
      deviceFingerprint?: string | null;
      riskScore?: number;
      anomalyReasons?: string[];
      startedAt?: Date;
      immediateAlertSentAt?: Date | null;
      criticalAlertSentAt?: Date | null;
    }) | null>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    create: (args: Record<string, unknown>) => Promise<{ id: string }>;
  };
};

export async function getOrCreateAuditSession(
  input: GetOrCreateSessionInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<SessionResult> {
  // Guard: no prisma client
  if (!prisma) {
    return { sessionId: "", isNew: false, sessionData: null };
  }

  const clientType: ClientType = detectClientType({
    userAgent: input.userAgent,
    xClientType: input.xClientType,
    hasValidSession: input.hasValidSession,
  });
  const environment = detectEnvironment();
  const now = new Date();

  // Identity key: userId > userEmail > anonymous
  const identityKey =
    input.userId ??
    input.userEmail ??
    `anon_${hashCode(input.ipAddress + (input.userAgent ?? ""))}`;

  const confidence = computeConfidence({
    clientType,
    hasFingerprint: !!input.deviceFingerprint,
    ipAddress: input.ipAddress,
  });

  return (prisma as PrismaLike).$transaction(async (tx) => {
    // Acquire advisory lock scoped to identity + clientType + IP
    const lockKey = hashCode(
      `audit_session_${identityKey}_${clientType}_${input.ipAddress}`
    );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(lockKey)})`;

    // Build WHERE clause based on identity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: Record<string, any> = {
      endedAt: null,
      clientType,
      ipAddress: input.ipAddress,
    };

    if (input.userId) {
      whereClause.userId = input.userId;
    } else if (input.userEmail) {
      whereClause.userEmail = input.userEmail;
    } else {
      // Anonymous: match on ipAddress + userAgent (ipAddress already in where)
      whereClause.userAgent = input.userAgent;
    }

    // Select fields needed for both match resolution and anomaly context.
    // Includes alert timestamps to avoid a redundant findUnique later.
    const sessionSelect = {
      id: true,
      clientType: true,
      ipAddress: true,
      endedAt: true,
      lastActiveAt: true,
      userId: true,
      userEmail: true,
      environment: true,
      deviceFingerprint: true,
      riskScore: true,
      anomalyReasons: true,
      startedAt: true,
      immediateAlertSentAt: true,
      criticalAlertSentAt: true,
    };

    // Look for existing open session
    const existing = await tx.auditSession.findFirst({
      where: whereClause,
      orderBy: { lastActiveAt: "desc" },
      select: sessionSelect,
    });

    if (existing) {
      const decision = resolveSessionMatch(existing, {
        clientType,
        ipAddress: input.ipAddress,
        now,
      });

      if (decision === "REUSE") {
        await tx.auditSession.update({
          where: { id: existing.id },
          data: { lastActiveAt: now },
        });

        const sessionData: AuditSessionLike = {
          id: existing.id,
          userId: existing.userId ?? null,
          userEmail: existing.userEmail ?? null,
          clientType: existing.clientType,
          environment: existing.environment ?? environment,
          ipAddress: existing.ipAddress,
          deviceFingerprint: existing.deviceFingerprint ?? null,
          riskScore: existing.riskScore ?? 0,
          anomalyReasons: existing.anomalyReasons ?? [],
          startedAt: existing.startedAt ?? now,
          immediateAlertSentAt: existing.immediateAlertSentAt ?? null,
          criticalAlertSentAt: existing.criticalAlertSentAt ?? null,
        };

        return { sessionId: existing.id, isNew: false, sessionData };
      }

      // Close the old session
      await tx.auditSession.update({
        where: { id: existing.id },
        data: { endedAt: existing.lastActiveAt },
      });
    }

    // Create new session
    const created = await tx.auditSession.create({
      data: {
        userId: input.userId,
        userEmail: input.userEmail,
        userName: input.userName,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        clientType,
        environment,
        confidence,
        deviceFingerprint: input.deviceFingerprint ?? null,
        fingerprintVersion: input.fingerprintVersion ?? null,
        startedAt: now,
        lastActiveAt: now,
        endedAt: null,
      },
    });

    const sessionData: AuditSessionLike = {
      id: created.id,
      userId: input.userId,
      userEmail: input.userEmail,
      clientType,
      environment,
      ipAddress: input.ipAddress,
      deviceFingerprint: input.deviceFingerprint ?? null,
      riskScore: 0,
      anomalyReasons: [],
      startedAt: now,
      immediateAlertSentAt: null,
      criticalAlertSentAt: null,
    };

    return { sessionId: created.id, isNew: true, sessionData };
  });
}

// ---------------------------------------------------------------------------
// runSessionAnomalyChecks -- called after session resolution
// ---------------------------------------------------------------------------

/**
 * Run anomaly checks for the current activity on the given session.
 * Called after getOrCreateAuditSession, non-blocking.
 */
export async function runSessionAnomalyChecks(
  session: AuditSessionLike,
  activityRiskScore: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<void> {
  if (!prisma) return;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Build identity-based where for history queries
  const identityWhere: Record<string, unknown> = {};
  if (session.userId) {
    identityWhere.userId = session.userId;
  } else if (session.userEmail) {
    identityWhere.userEmail = session.userEmail;
  } else {
    identityWhere.ipAddress = session.ipAddress;
    // For anonymous: can't check device/IP history meaningfully
    return;
  }

  const [fingerprintHistory, ipHistory, recentMutatingCount] =
    await Promise.all([
      session.deviceFingerprint
        ? prisma.auditSession.count({
            where: {
              ...identityWhere,
              deviceFingerprint: session.deviceFingerprint,
              id: { not: session.id },
              startedAt: { gte: thirtyDaysAgo },
            },
          })
        : Promise.resolve(0),

      prisma.auditSession.count({
        where: {
          ...identityWhere,
          ipAddress: session.ipAddress,
          id: { not: session.id },
          startedAt: { gte: thirtyDaysAgo },
        },
      }),

      prisma.activityLog.count({
        where: {
          auditSessionId: session.id,
          createdAt: { gte: fiveMinAgo },
          riskScore: { gte: 2 },
        },
      }),
    ]);

  await runAnomalyChecks(
    {
      session,
      activityRiskScore,
      mutatingActionCountLast5Min: recentMutatingCount,
      fingerprintKnown: fingerprintHistory > 0,
      ipKnown: ipHistory > 0,
    },
    prisma
  );
}
