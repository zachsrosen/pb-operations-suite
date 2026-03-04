/**
 * Portal Token Utilities
 *
 * Handles token generation, hashing, and validation for the customer
 * survey self-scheduling portal. Raw tokens are NEVER stored in the
 * database — only their SHA-256 hashes.
 */

import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { SurveyInviteStatus } from "@/generated/prisma/enums";

// Active statuses — invites that are still actionable
const ACTIVE_STATUSES: SurveyInviteStatus[] = ["PENDING", "SCHEDULED", "RESCHEDULED"];

/** 32-byte token → 43-char base64url string (no padding) */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url"); // 43 chars
  const hash = hashToken(raw);
  return { raw, hash };
}

/** SHA-256 hex digest of a raw token */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Token validation result */
export type TokenValidation =
  | { valid: true; invite: ValidatedInvite }
  | { valid: false; reason: "not_found" | "expired" | "inactive" };

export type ValidatedInvite = {
  id: string;
  tokenHash: string;
  dealId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string | null;
  propertyAddress: string;
  pbLocation: string;
  systemSize: number | null;
  status: SurveyInviteStatus;
  expiresAt: Date;
  scheduledAt: Date | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  cutoffAt: Date | null;
  crewMemberId: string | null;
  scheduleRecordId: string | null;
  zuperJobUid: string | null;
  accessNotes: string | null;
};

/**
 * Validate a raw token from a portal URL.
 * Hashes the token, looks up the invite, checks expiry and status.
 */
export async function validateToken(rawToken: string): Promise<TokenValidation> {
  if (!prisma) {
    return { valid: false, reason: "not_found" };
  }

  const tokenHash = hashToken(rawToken);

  const invite = await prisma.surveyInvite.findUnique({
    where: { tokenHash },
  });

  if (!invite) {
    return { valid: false, reason: "not_found" };
  }

  // Check expiry
  if (new Date() > invite.expiresAt) {
    // Mark as expired if still in an active status
    if (ACTIVE_STATUSES.includes(invite.status)) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      }).catch(() => { /* best-effort status update */ });
    }
    return { valid: false, reason: "expired" };
  }

  // Check status — only PENDING and SCHEDULED invites are actionable
  if (!ACTIVE_STATUSES.includes(invite.status)) {
    return { valid: false, reason: "inactive" };
  }

  return { valid: true, invite };
}

/**
 * Check if a deal already has an active invite (PENDING or SCHEDULED).
 * Used as app-level fast-path guard before creating new invites.
 * The partial unique index on SurveyInvite(dealId) enforces this at DB level too.
 */
export async function hasActiveInvite(dealId: string): Promise<boolean> {
  if (!prisma) return false;

  const count = await prisma.surveyInvite.count({
    where: {
      dealId,
      status: { in: ACTIVE_STATUSES },
    },
  });

  return count > 0;
}
