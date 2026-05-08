/**
 * Goals Weekly Digest audience list.
 *
 * Recipients: leadership (ADMIN, OWNER/EXECUTIVE) and ops directors
 * (OPS_MGR, PROJECT_MANAGER).
 *
 * Unlike PM-tracker audience which is a static allowlist, this pulls from
 * the User table by role so new hires automatically receive the digest.
 */

import { prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma";

/** Roles that receive the weekly goals digest */
const DIGEST_ROLES: UserRole[] = [
  "ADMIN",
  "EXECUTIVE",
  "OWNER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
];

/**
 * Fetch unique email addresses for all users with digest-eligible roles.
 * Falls back to a hardcoded list if DB is unreachable.
 */
export async function getGoalsDigestAudience(): Promise<string[]> {
  try {
    const users = await prisma.user.findMany({
      where: {
        roles: { hasSome: DIGEST_ROLES },
      },
      select: { email: true },
    });

    const emails = [
      ...new Set(
        users
          .map((u) => u.email?.toLowerCase().trim())
          .filter((e): e is string => !!e),
      ),
    ];

    if (emails.length > 0) return emails;
  } catch (err) {
    console.error("[goals-digest] Failed to fetch audience from DB:", err);
  }

  // Fallback: at minimum always send to the owner
  return ["zach@photonbrothers.com"];
}
