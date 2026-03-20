import { createHmac, timingSafeEqual } from "crypto";

export type SyncSystem = "zoho" | "hubspot" | "zuper";

export const CATALOG_SYNC_CONFIRM_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SyncConfirmationInput {
  internalProductId: string;
  systems: SyncSystem[];
  changesHash: string;
  issuedAt: number;
}

function trim(value: unknown): string {
  return String(value || "").trim();
}

export function isCatalogSyncEnabled(): boolean {
  return trim(process.env.CATALOG_SYNC_ENABLED).toLowerCase() === "true";
}

export function getSyncConfirmationSecret(): string | null {
  const candidates = [
    process.env.PRODUCT_CLEANUP_CONFIRM_SECRET,
    process.env.AUTH_TOKEN_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.API_SECRET_TOKEN,
  ];

  for (const candidate of candidates) {
    const normalized = trim(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function toCanonicalPayload(input: SyncConfirmationInput): string {
  const normalizedSystems = [...new Set(input.systems)].sort() as SyncSystem[];

  return JSON.stringify({
    internalProductId: trim(input.internalProductId),
    systems: normalizedSystems,
    changesHash: trim(input.changesHash),
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

export function createSyncConfirmationToken(
  input: SyncConfirmationInput,
  secretOverride?: string,
): string {
  const secret = trim(secretOverride) || getSyncConfirmationSecret();
  if (!secret) {
    throw new Error(
      "Sync confirmation secret not configured. Set PRODUCT_CLEANUP_CONFIRM_SECRET, AUTH_TOKEN_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, or API_SECRET_TOKEN.",
    );
  }

  return createHmac("sha256", secret).update(toCanonicalPayload(input)).digest("hex");
}

export function validateSyncConfirmationToken(input: {
  token: string;
  issuedAt: number;
  internalProductId: string;
  systems: SyncSystem[];
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
    expectedToken = createSyncConfirmationToken({
      internalProductId: input.internalProductId,
      systems: input.systems,
      changesHash: input.changesHash,
      issuedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Sync confirmation secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}

export function buildSyncConfirmation(input: {
  internalProductId: string;
  systems: SyncSystem[];
  changesHash: string;
  issuedAt?: number;
}) {
  const issuedAt = typeof input.issuedAt === "number" ? Math.trunc(input.issuedAt) : Date.now();
  return {
    token: createSyncConfirmationToken({
      internalProductId: input.internalProductId,
      systems: input.systems,
      changesHash: input.changesHash,
      issuedAt,
    }),
    issuedAt,
    expiresAt: issuedAt + CATALOG_SYNC_CONFIRM_TTL_MS,
  };
}

// ── Plan-hash-based confirmation (new sync relay flow) ──

interface PlanConfirmationInput {
  internalProductId: string;
  planHash: string;
  issuedAt: number;
}

function toPlanCanonicalPayload(input: PlanConfirmationInput): string {
  return JSON.stringify({
    internalProductId: input.internalProductId,
    planHash: input.planHash,
    issuedAt: Math.trunc(input.issuedAt),
  });
}

export async function createPlanConfirmationToken(
  input: PlanConfirmationInput,
): Promise<string | null> {
  const secret = getSyncConfirmationSecret();
  if (!secret) return null;
  const payload = toPlanCanonicalPayload(input);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function validatePlanConfirmationToken(
  input: PlanConfirmationInput & { token: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  if (input.issuedAt > now + 60_000) {
    return { ok: false, error: "Token issued in the future" };
  }
  if (now - input.issuedAt > CATALOG_SYNC_CONFIRM_TTL_MS) {
    return { ok: false, error: "Token expired" };
  }
  const expected = await createPlanConfirmationToken(input);
  if (!expected || !secureEquals(input.token, expected)) {
    return { ok: false, error: "Invalid token" };
  }
  return { ok: true };
}

export function buildPlanConfirmation(
  internalProductId: string,
  planHash: string,
  issuedAt?: number,
): Promise<{ token: string; issuedAt: number; expiresAt: number } | null> {
  const now = issuedAt ?? Date.now();
  return createPlanConfirmationToken({
    internalProductId,
    planHash,
    issuedAt: now,
  }).then((token) => {
    if (!token) return null;
    return {
      token,
      issuedAt: now,
      expiresAt: now + CATALOG_SYNC_CONFIRM_TTL_MS,
    };
  });
}
