import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { ROLES } from "@/lib/roles";
import type { CanonicalLocation } from "@/lib/locations";

export type AccessScope =
  | { type: "global" }
  | { type: "location"; locations: CanonicalLocation[] }
  | { type: "owner"; userId: string };

export type ScopeType = "global" | "location" | "owner";

/**
 * Per-role scope type, derived from the canonical `ROLES` map so adding or
 * changing a role's scope only requires editing `lib/roles.ts`.
 */
export const ROLE_SCOPE_TYPE: Record<UserRole, ScopeType> = Object.fromEntries(
  Object.entries(ROLES).map(([role, def]) => [role, def.scope])
) as Record<UserRole, ScopeType>;

export function getScopeTypeForRole(role?: string | null): ScopeType {
  return ROLE_SCOPE_TYPE[normalizeRole((role || "VIEWER") as UserRole)];
}
