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

// Booked statuses — the customer has a slot. These block a duplicate invite
// regardless of token TTL, and are never swept by the expiry sweeper.
const BOOKED_STATUSES: SurveyInviteStatus[] = ["SCHEDULED", "RESCHEDULED"];


// Portal-accessible statuses — tokens that can still load the portal
// Includes CANCELLED so customers can reschedule after cancelling
const PORTAL_ACCESSIBLE_STATUSES: SurveyInviteStatus[] = ["PENDING", "SCHEDULED", "RESCHEDULED", "CANCELLED"];

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
  sentBy: string | null;
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

  // Check expiry. Expiry only applies to invites the customer never acted on:
  // a booked invite past its TTL is still a real booking, and killing it here
  // would lock the customer out of rescheduling their own survey.
  if (new Date() > invite.expiresAt && !BOOKED_STATUSES.includes(invite.status)) {
    if (invite.status === "PENDING") {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      }).catch(() => { /* best-effort status update */ });
    }
    return { valid: false, reason: "expired" };
  }

  // Check status — allow portal access for active + cancelled (for reschedule)
  if (!PORTAL_ACCESSIBLE_STATUSES.includes(invite.status)) {
    return { valid: false, reason: "inactive" };
  }

  return { valid: true, invite };
}

/**
 * Check if a deal already has an invite that should block a new one.
 *
 * "Active" means either an unexpired PENDING invite (the customer can still
 * use the link we sent) or any booking (SCHEDULED / RESCHEDULED), which blocks
 * regardless of token TTL because the survey is really on the calendar.
 *
 * A LAPSED pending invite does not block. That was the bug: this counted by
 * status alone, and nothing ever moved a lapsed invite off PENDING, so one
 * un-clicked link locked the deal out of re-invites forever.
 */
export async function hasActiveInvite(dealId: string): Promise<boolean> {
  if (!prisma) return false;

  const count = await prisma.surveyInvite.count({
    where: {
      dealId,
      OR: [
        { status: "PENDING", expiresAt: { gt: new Date() } },
        { status: { in: BOOKED_STATUSES } },
      ],
    },
  });

  return count > 0;
}

/** Minimal client shape — accepts the Prisma client or a transaction client. */
interface InviteSweepClient {
  surveyInvite: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

/**
 * Flip lapsed PENDING invites to EXPIRED, returning how many were swept.
 *
 * Two callers: the invite routes (scoped to one deal, inside the create
 * transaction) so the partial unique index on (dealId) WHERE status IN
 * ('PENDING','SCHEDULED') sees a clean slate, and the nightly cron (unscoped)
 * so the table reflects reality even for deals nobody re-invites.
 *
 * Only ever touches PENDING. Sweeping a booking would strand the customer.
 */
export async function expireStaleInvites(
  dealId?: string,
  client: InviteSweepClient | null = prisma,
): Promise<number> {
  if (!client) return 0;

  const { count } = await client.surveyInvite.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: new Date() },
      ...(dealId ? { dealId } : {}),
    },
    data: { status: "EXPIRED" },
  });

  return count;
}

