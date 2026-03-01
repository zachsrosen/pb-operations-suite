/**
 * Audit session resolution with race-safe transaction logic.
 *
 * Types are defined as string literal unions matching the Prisma enums
 * so this module works without a generated Prisma client.
 */

import { detectEnvironment, detectClientType, isPrivateIP } from "./detect";

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
// Constants
// ---------------------------------------------------------------------------
export const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// hashCode — DJB2 string hash returning a 32-bit integer
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
// resolveSessionMatch — pure function
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
// computeConfidence — pure function
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
// getOrCreateAuditSession — race-safe DB transaction
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
}

// Minimal Prisma-like type so we don't need the generated client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = {
  $transaction: (
    fn: (tx: PrismaTransactionClient) => Promise<SessionResult>
  ) => Promise<SessionResult>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaTransactionClient = {
  $executeRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  auditSession: {
    findFirst: (args: Record<string, unknown>) => Promise<SessionCandidate | null>;
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
    return { sessionId: "", isNew: false };
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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

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

    // Look for existing open session
    const existing = await tx.auditSession.findFirst({
      where: whereClause,
      orderBy: { lastActiveAt: "desc" },
      select: {
        id: true,
        clientType: true,
        ipAddress: true,
        endedAt: true,
        lastActiveAt: true,
      },
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
        return { sessionId: existing.id, isNew: false };
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
        confidenceLevel: confidence,
        deviceFingerprint: input.deviceFingerprint ?? null,
        fingerprintVersion: input.fingerprintVersion ?? null,
        startedAt: now,
        lastActiveAt: now,
        endedAt: null,
      },
    });

    return { sessionId: created.id, isNew: true };
  });
}
