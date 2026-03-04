import { createHmac, createHash, timingSafeEqual } from "crypto";
import { getSyncConfirmationSecret } from "@/lib/catalog-sync-confirmation";

export const DEDUP_CONFIRM_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DEDUP_MAX_DELETES = 50;

export interface DedupClusterDecision {
  keepId: string;
  deleteIds: string[];
}

interface DedupConfirmationInput {
  clusters: DedupClusterDecision[];
  issuedAt: number;
}

function trim(value: unknown): string {
  return String(value || "").trim();
}

function toCanonicalPayload(input: DedupConfirmationInput): string {
  const normalizedClusters = input.clusters
    .map((c) => ({
      keepId: trim(c.keepId),
      deleteIds: [...new Set(c.deleteIds.map((id) => trim(id)).filter(Boolean))].sort(),
    }))
    .sort((a, b) => a.keepId.localeCompare(b.keepId));

  return JSON.stringify({
    clusters: normalizedClusters,
    issuedAt: Math.trunc(input.issuedAt),
  });
}

function secureEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function createDedupConfirmationToken(
  input: DedupConfirmationInput,
  secretOverride?: string,
): string {
  const secret = trim(secretOverride) || getSyncConfirmationSecret();
  if (!secret) {
    throw new Error(
      "Dedup confirmation secret not configured. Set PRODUCT_CLEANUP_CONFIRM_SECRET, AUTH_TOKEN_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, or API_SECRET_TOKEN.",
    );
  }

  return createHmac("sha256", secret).update(toCanonicalPayload(input)).digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(trim(token)).digest("hex");
}

export function validateDedupConfirmationToken(input: {
  token: string;
  issuedAt: number;
  clusters: DedupClusterDecision[];
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const maxSkewMs = 60_000;

  if (issuedAt > now + maxSkewMs) {
    return { ok: false, error: "Confirmation token issuedAt is in the future." };
  }

  if (now - issuedAt > DEDUP_CONFIRM_TTL_MS) {
    return {
      ok: false,
      error: "Confirmation token expired. Please confirm again and retry.",
    };
  }

  // Validate delete count
  const totalDeletes = input.clusters.reduce((sum, c) => sum + c.deleteIds.length, 0);
  if (totalDeletes > DEDUP_MAX_DELETES) {
    return {
      ok: false,
      error: `Maximum ${DEDUP_MAX_DELETES} deletions per request. Got ${totalDeletes}. Break into smaller batches.`,
    };
  }

  let expectedToken = "";
  try {
    expectedToken = createDedupConfirmationToken({
      clusters: input.clusters,
      issuedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Dedup confirmation secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}

export function buildDedupConfirmation(input: {
  clusters: DedupClusterDecision[];
  issuedAt?: number;
}) {
  // Validate delete count upfront
  const totalDeletes = input.clusters.reduce((sum, c) => sum + c.deleteIds.length, 0);
  if (totalDeletes > DEDUP_MAX_DELETES) {
    throw new Error(
      `Maximum ${DEDUP_MAX_DELETES} deletions per request. Got ${totalDeletes}. Break into smaller batches.`,
    );
  }

  const issuedAt = typeof input.issuedAt === "number" ? Math.trunc(input.issuedAt) : Date.now();
  return {
    token: createDedupConfirmationToken({
      clusters: input.clusters,
      issuedAt,
    }),
    issuedAt,
    expiresAt: issuedAt + DEDUP_CONFIRM_TTL_MS,
  };
}
