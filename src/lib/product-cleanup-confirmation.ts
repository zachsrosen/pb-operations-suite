import { createHmac, timingSafeEqual } from "crypto";
import { PRODUCT_CLEANUP_CONFIRM_TTL_MS, type ProductCleanupRequest } from "@/lib/schemas/product-cleanup";

export type ProductCleanupActions = ProductCleanupRequest["actions"];

interface ConfirmationInput {
  internalSkuIds: string[];
  actions: ProductCleanupActions;
  issuedAt: number;
}

function trim(value: unknown): string {
  return String(value || "").trim();
}

export function isProductCleanupEnabled(): boolean {
  return trim(process.env.PRODUCT_CLEANUP_ENABLED).toLowerCase() === "true";
}

export function getProductCleanupConfirmationSecret(): string | null {
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

function toCanonicalConfirmationPayload(input: ConfirmationInput): string {
  const normalizedSkuIds = [...new Set(input.internalSkuIds.map((id) => trim(id)).filter(Boolean))].sort();
  const normalizedActions = {
    internal: input.actions.internal,
    links: input.actions.links,
    external: input.actions.external,
    sources: [...input.actions.sources],
    deleteCachedProducts: Boolean(input.actions.deleteCachedProducts),
  } as const;

  return JSON.stringify({
    internalSkuIds: normalizedSkuIds,
    actions: normalizedActions,
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

export function createProductCleanupConfirmationToken(
  input: ConfirmationInput,
  secretOverride?: string
): string {
  const secret = trim(secretOverride) || getProductCleanupConfirmationSecret();
  if (!secret) {
    throw new Error(
      "Cleanup confirmation secret not configured. Set PRODUCT_CLEANUP_CONFIRM_SECRET, AUTH_TOKEN_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, or API_SECRET_TOKEN."
    );
  }

  return createHmac("sha256", secret).update(toCanonicalConfirmationPayload(input)).digest("hex");
}

export function validateProductCleanupConfirmationToken(input: {
  token: string;
  issuedAt: number;
  internalSkuIds: string[];
  actions: ProductCleanupActions;
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const maxSkewMs = 60_000;

  if (issuedAt > now + maxSkewMs) {
    return { ok: false, error: "Confirmation token issuedAt is in the future." };
  }

  if (now - issuedAt > PRODUCT_CLEANUP_CONFIRM_TTL_MS) {
    return {
      ok: false,
      error: "Confirmation token expired. Please confirm again and retry.",
    };
  }

  let expectedToken = "";
  try {
    expectedToken = createProductCleanupConfirmationToken({
      internalSkuIds: input.internalSkuIds,
      actions: input.actions,
      issuedAt,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Cleanup confirmation secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}

export function buildCleanupConfirmation(input: {
  internalSkuIds: string[];
  actions: ProductCleanupActions;
  issuedAt?: number;
}) {
  const issuedAt = typeof input.issuedAt === "number" ? Math.trunc(input.issuedAt) : Date.now();
  return {
    token: createProductCleanupConfirmationToken({
      internalSkuIds: input.internalSkuIds,
      actions: input.actions,
      issuedAt,
    }),
    issuedAt,
    expiresAt: issuedAt + PRODUCT_CLEANUP_CONFIRM_TTL_MS,
  };
}
