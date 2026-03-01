/**
 * Generic admin-action HMAC confirmation.
 *
 * Reusable for: catalog cleanup, SKU deletion, admin override creation,
 * bulk operations. Same HMAC-SHA256 + timingSafeEqual + 5-minute TTL.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_CLOCK_SKEW_MS = 60_000;  // 1 minute

function trim(value: unknown): string {
  return String(value || "").trim();
}

export function getAdminActionSecret(): string | null {
  const candidates = [
    process.env.ADMIN_ACTION_SECRET,
    process.env.PRODUCT_CLEANUP_CONFIRM_SECRET,
    process.env.AUTH_TOKEN_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.API_SECRET_TOKEN,
  ];
  for (const c of candidates) {
    const normalized = trim(c);
    if (normalized) return normalized;
  }
  return null;
}

function canonicalPayload(payload: unknown, issuedAt: number): string {
  return JSON.stringify({ payload, issuedAt: Math.trunc(issuedAt) });
}

function secureEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function createAdminActionToken(
  input: { payload: unknown; issuedAt: number },
  secretOverride?: string
): string {
  const secret = trim(secretOverride) || getAdminActionSecret();
  if (!secret) {
    throw new Error(
      "Admin action secret not configured. Set ADMIN_ACTION_SECRET or PRODUCT_CLEANUP_CONFIRM_SECRET."
    );
  }
  return createHmac("sha256", secret)
    .update(canonicalPayload(input.payload, input.issuedAt))
    .digest("hex");
}

export function validateAdminActionToken(input: {
  token: string;
  payload: unknown;
  issuedAt: number;
  secret?: string;
  ttlMs?: number;
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;

  if (issuedAt > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: "Token issuedAt is in the future." };
  }

  if (now - issuedAt > ttlMs) {
    return { ok: false, error: "Token expired. Please confirm again and retry." };
  }

  let expectedToken: string;
  try {
    expectedToken = createAdminActionToken(
      { payload: input.payload, issuedAt },
      input.secret
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}
