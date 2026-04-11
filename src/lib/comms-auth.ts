/**
 * Comms-specific auth resolver.
 *
 * Unlike getCurrentUser(), this NEVER resolves to the impersonated user.
 * Comms routes handle personal Gmail/Chat tokens — impersonation would
 * route API calls through another user's inbox.
 */

import { auth } from "@/auth";
import { getUserByEmail } from "./db";
import { normalizeRole, UserRole } from "./role-permissions";

export interface CommsUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface CommsAuthResult {
  user: CommsUser | null;
  blocked: boolean; // true = impersonation active, Comms unavailable
}

export async function getActualCommsUser(): Promise<CommsAuthResult> {
  const session = await auth();

  if (!session?.user?.email) {
    return { user: null, blocked: false };
  }

  const dbUser = await getUserByEmail(session.user.email);
  if (!dbUser) {
    return { user: null, blocked: false };
  }

  // Block Comms entirely while impersonating
  if (dbUser.impersonatingUserId) {
    return { user: null, blocked: true };
  }

  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? undefined,
      role: normalizeRole(dbUser.role as UserRole),
    },
    blocked: false,
  };
}
