import "server-only";

import type { User } from "@/generated/prisma/client";
import type { UserRole } from "@/lib/role-permissions";
import { normalizeRole } from "@/lib/role-permissions";
import { prisma, getUserByEmail } from "@/lib/db";
import { type AccessScope, getScopeTypeForRole } from "@/lib/access-scope";
import { normalizeLocation, type CanonicalLocation } from "@/lib/locations";

export interface ResolvedScope {
  user: User | null;
  effectiveRole: UserRole;
  scope: AccessScope;
  isImpersonating: boolean;
  adminEmail: string | null;
}

function buildLocationScope(
  allowedLocations: string[],
  scopeEnforcementEnabled: boolean
): AccessScope {
  const normalizedLocations = Array.from(
    new Set(
      allowedLocations
        .map((location) => normalizeLocation(location))
        .filter((location): location is CanonicalLocation => Boolean(location))
    )
  );

  if (normalizedLocations.length === 0 && !scopeEnforcementEnabled) {
    return { type: "global" };
  }

  return { type: "location", locations: normalizedLocations };
}

export async function resolveAccessScope(
  email: string,
  options?: { scopeEnforcementEnabled?: boolean }
): Promise<ResolvedScope | null> {
  const scopeEnforcementEnabled = options?.scopeEnforcementEnabled === true;

  if (email === "api@system") {
    return {
      user: null,
      effectiveRole: "ADMIN",
      scope: { type: "global" },
      isImpersonating: false,
      adminEmail: null,
    };
  }

  const dbUser = await getUserByEmail(email);
  if (!dbUser) return null;

  let effectiveUser = dbUser;
  let isImpersonating = false;
  let adminEmail: string | null = null;

  if (dbUser.role === "ADMIN" && dbUser.impersonatingUserId && prisma) {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: dbUser.impersonatingUserId },
    });
    if (impersonatedUser) {
      effectiveUser = impersonatedUser;
      isImpersonating = true;
      adminEmail = dbUser.email;
    }
  }

  const effectiveRole = normalizeRole(effectiveUser.role as UserRole);
  const scopeType = getScopeTypeForRole(effectiveRole);

  if (scopeType === "global") {
    return {
      user: effectiveUser,
      effectiveRole,
      scope: { type: "global" },
      isImpersonating,
      adminEmail,
    };
  }

  if (scopeType === "owner") {
    return {
      user: effectiveUser,
      effectiveRole,
      scope: { type: "owner", userId: effectiveUser.id },
      isImpersonating,
      adminEmail,
    };
  }

  return {
    user: effectiveUser,
    effectiveRole,
    scope: buildLocationScope(effectiveUser.allowedLocations, scopeEnforcementEnabled),
    isImpersonating,
    adminEmail,
  };
}
