/**
 * HMAC confirmation helpers for bulk HubSpot sync operations.
 *
 * Extends the single-SKU pattern from catalog-sync-confirmation.ts with
 * operation-scoped payloads, continuation tokens, and two canonical hash
 * helpers (deal line-item diff vs. bulk SKU catalog sync).
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

import {
  CATALOG_SYNC_CONFIRM_TTL_MS,
  getSyncConfirmationSecret,
} from "./catalog-sync-confirmation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type BulkSyncOperation =
  | "deal-line-item-sync"
  | "hubspot-product-bulk-sync";

export interface BulkSyncConfirmationInput {
  operation: BulkSyncOperation;
  operationId: string; // dealId for diff/fill, "all" for bulk catalog
  changesHash: string; // canonical hash of items to sync
  issuedAt: number;
}

export interface ContinuationTokenInput {
  runId: string;
  tokenHash: string;
  cursor: string;
  executedBy: string;
  issuedAt: number;
}

// Continuation tokens get a shorter TTL — they're issued per-chunk
const CONTINUATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

function trim(value: unknown): string {
  return String(value || "").trim();
}

function requireSecret(): string {
  const secret = getSyncConfirmationSecret();
  if (!secret) {
    throw new Error(
      "Sync confirmation secret not configured. Set PRODUCT_CLEANUP_CONFIRM_SECRET, AUTH_TOKEN_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, or API_SECRET_TOKEN.",
    );
  }
  return secret;
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

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ──────────────────────────────────────────────
// Canonical payload for bulk sync HMAC
// ──────────────────────────────────────────────

function toBulkSyncCanonicalPayload(input: BulkSyncConfirmationInput): string {
  return JSON.stringify({
    operation: trim(input.operation),
    operationId: trim(input.operationId),
    changesHash: trim(input.changesHash),
    issuedAt: Math.trunc(input.issuedAt),
  });
}

// ──────────────────────────────────────────────
// HMAC token creation / validation
// ──────────────────────────────────────────────

export function createBulkSyncToken(input: BulkSyncConfirmationInput): string {
  const secret = requireSecret();
  return createHmac("sha256", secret)
    .update(toBulkSyncCanonicalPayload(input))
    .digest("hex");
}

export function buildBulkSyncConfirmation(input: {
  operation: BulkSyncOperation;
  operationId: string;
  changesHash: string;
  issuedAt?: number;
}) {
  const issuedAt =
    typeof input.issuedAt === "number" ? Math.trunc(input.issuedAt) : Date.now();
  return {
    token: createBulkSyncToken({
      operation: input.operation,
      operationId: input.operationId,
      changesHash: input.changesHash,
      issuedAt,
    }),
    issuedAt,
    expiresAt: issuedAt + CATALOG_SYNC_CONFIRM_TTL_MS,
  };
}

export function validateBulkSyncToken(input: {
  token: string;
  issuedAt: number;
  operation: BulkSyncOperation;
  operationId: string;
  changesHash: string;
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const maxSkewMs = 60_000;

  if (issuedAt > now + maxSkewMs) {
    return { ok: false, error: "Confirmation token issuedAt is in the future." };
  }

  if (now - issuedAt > CATALOG_SYNC_CONFIRM_TTL_MS) {
    return {
      ok: false,
      error: "Confirmation token expired. Please confirm again and retry.",
    };
  }

  let expectedToken = "";
  try {
    expectedToken = createBulkSyncToken({
      operation: input.operation,
      operationId: input.operationId,
      changesHash: input.changesHash,
      issuedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Sync confirmation secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}

// ──────────────────────────────────────────────
// Token hash (for DB idempotency key)
// ──────────────────────────────────────────────

export function hashToken(token: string): string {
  return sha256(token);
}

// ──────────────────────────────────────────────
// Continuation tokens (for chunked bulk sync)
// ──────────────────────────────────────────────

function toContinuationCanonicalPayload(input: ContinuationTokenInput): string {
  return JSON.stringify({
    runId: trim(input.runId),
    tokenHash: trim(input.tokenHash),
    cursor: trim(input.cursor),
    executedBy: trim(input.executedBy),
    issuedAt: Math.trunc(input.issuedAt),
  });
}

export function createContinuationToken(input: ContinuationTokenInput): string {
  const secret = requireSecret();
  return createHmac("sha256", secret)
    .update(toContinuationCanonicalPayload(input))
    .digest("hex");
}

export function buildContinuationToken(input: {
  runId: string;
  tokenHash: string;
  cursor: string;
  executedBy: string;
}) {
  const issuedAt = Date.now();
  return {
    continuationToken: createContinuationToken({
      runId: input.runId,
      tokenHash: input.tokenHash,
      cursor: input.cursor,
      executedBy: input.executedBy,
      issuedAt,
    }),
    issuedAt,
    expiresAt: issuedAt + CONTINUATION_TTL_MS,
  };
}

export function validateContinuationToken(input: {
  continuationToken: string;
  runId: string;
  tokenHash: string;
  cursor: string;
  executedBy: string;
  issuedAt: number;
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const maxSkewMs = 60_000;

  if (issuedAt > now + maxSkewMs) {
    return { ok: false, error: "Continuation token issuedAt is in the future." };
  }

  if (now - issuedAt > CONTINUATION_TTL_MS) {
    return {
      ok: false,
      error: "Continuation token expired. Please re-confirm and retry.",
    };
  }

  let expectedToken = "";
  try {
    expectedToken = createContinuationToken({
      runId: input.runId,
      tokenHash: input.tokenHash,
      cursor: input.cursor,
      executedBy: input.executedBy,
      issuedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Sync confirmation secret is missing.",
    };
  }

  if (!secureEquals(trim(input.continuationToken), expectedToken)) {
    return { ok: false, error: "Invalid continuation token." };
  }

  return { ok: true };
}

// ──────────────────────────────────────────────
// Canonical hash: Deal line-item sync
// ──────────────────────────────────────────────

export interface DealSyncRow {
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
}

/**
 * Canonical hash for diff/fill sync.
 * Binds ALL payload fields so any field change after confirm invalidates the token.
 */
export function computeDealSyncChangesHash(
  dealId: string,
  rows: DealSyncRow[],
): string {
  const normalized = rows.map((r) => ({
    category: trim(r.category).toLowerCase(),
    brand: trim(r.brand).toLowerCase(),
    model: trim(r.model).toLowerCase(),
    description: trim(r.description).toLowerCase(),
    qty: Number(r.qty) || 0,
    unitSpec: r.unitSpec != null ? Number(r.unitSpec) || 0 : null,
    unitLabel: r.unitLabel != null ? trim(r.unitLabel).toLowerCase() : null,
  }));

  // Deterministic sort: category → brand → model → description
  normalized.sort((a, b) => {
    const cmp1 = a.category.localeCompare(b.category);
    if (cmp1 !== 0) return cmp1;
    const cmp2 = a.brand.localeCompare(b.brand);
    if (cmp2 !== 0) return cmp2;
    const cmp3 = a.model.localeCompare(b.model);
    if (cmp3 !== 0) return cmp3;
    return a.description.localeCompare(b.description);
  });

  return sha256(JSON.stringify({ dealId: trim(dealId), rows: normalized }));
}

// ──────────────────────────────────────────────
// Canonical hash: Bulk SKU catalog sync
// ──────────────────────────────────────────────

export interface BulkSkuSyncRow {
  id: string;
  category: string;
  brand: string | null;
  model: string | null;
}

/**
 * Canonical hash for bulk product catalog sync.
 * Separate from deal sync to prevent canonicalization drift.
 */
export function computeBulkSkuSyncHash(skus: BulkSkuSyncRow[]): string {
  const normalized = skus.map((s) => ({
    id: trim(s.id),
    category: trim(s.category).toLowerCase(),
    brand: trim(s.brand).toLowerCase(),
    model: trim(s.model).toLowerCase(),
  }));

  // Sort by id for determinism (cuid is unique and orderable)
  normalized.sort((a, b) => a.id.localeCompare(b.id));

  return sha256(JSON.stringify({ skus: normalized }));
}

// ──────────────────────────────────────────────
// HubSpot 429 retry wrapper
// ──────────────────────────────────────────────

export type HubSpotRetryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

/**
 * Retry wrapper for HubSpot API calls that may throw on 429.
 * Extracts Retry-After from error messages or defaults to exponential backoff.
 * Max 3 retries per call.
 */
export async function withHubSpotRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      // Check for 429 rate limit
      const is429 =
        msg.includes("429") ||
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("too many requests");

      if (!is429 || attempt === maxRetries) {
        break;
      }

      // Try to extract Retry-After from error message
      const retryAfterMatch = msg.match(/retry[- ]?after[:\s]*(\d+)/i);
      const waitMs = retryAfterMatch
        ? parseInt(retryAfterMatch[1], 10) * 1000
        : Math.min(1000 * 2 ** attempt, 10_000); // exponential: 1s, 2s, 4s

      console.warn(
        `[${label}] 429 rate limited, attempt ${attempt + 1}/${maxRetries}. Waiting ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  return { ok: false, error: `${label}: ${lastError}` };
}
