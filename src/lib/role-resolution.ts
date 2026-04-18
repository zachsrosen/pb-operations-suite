import "server-only";

import type { UserRole } from "@/generated/prisma/enums";
import { ROLES, type RoleDefinition } from "@/lib/roles";
import { prisma } from "@/lib/db";
import {
  resolveUserAccess,
  type EffectiveUserAccess,
  type UserLike,
} from "@/lib/user-access";

/**
 * Runtime role resolution with DB-backed overrides.
 *
 * Merges `RoleCapabilityOverride` rows (Option B) onto the static `ROLES` map
 * from `src/lib/roles.ts`. Non-null override fields win; null = inherit code default.
 *
 * Future: will also merge `RoleDefinitionOverride` (Option C).
 *
 * Cache: in-memory 30s TTL. Admin writes call `invalidateRoleCache(role)` to bust.
 */

const CACHE_TTL_MS = 30_000;
type CacheEntry = { def: RoleDefinition; expires: number };
const cache = new Map<UserRole, CacheEntry>();

export function invalidateRoleCache(role?: UserRole): void {
  if (role) cache.delete(role);
  else cache.clear();
}

/**
 * Resolve a role definition, applying DB overrides if any exist.
 *
 * Uses an in-memory cache with 30s TTL. If the underlying role is a legacy
 * value (e.g. OWNER), this returns the legacy entry as-is — normalization
 * happens at a higher layer in `resolveEffectiveRole`.
 *
 * Safe to call from Node runtime (server components, API routes). NOT
 * edge-safe because it hits Prisma; middleware uses the JWT's cached
 * `access` snapshot instead.
 */
export async function resolveRoleDefinition(role: UserRole): Promise<RoleDefinition> {
  const cached = cache.get(role);
  if (cached && cached.expires > Date.now()) return cached.def;

  const base = ROLES[role];
  if (!base) {
    // Unknown role string (shouldn't happen with typed enum, but defensive).
    return ROLES.VIEWER;
  }

  if (!prisma) {
    cache.set(role, { def: base, expires: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const override = await prisma.roleCapabilityOverride
    .findUnique({ where: { role } })
    .catch(() => null);

  if (!override) {
    cache.set(role, { def: base, expires: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const defaultCapabilities = { ...base.defaultCapabilities };
  const keys = Object.keys(defaultCapabilities) as Array<keyof typeof defaultCapabilities>;
  for (const key of keys) {
    const overrideVal = override[key];
    if (typeof overrideVal === "boolean") defaultCapabilities[key] = overrideVal;
  }

  const def: RoleDefinition = { ...base, defaultCapabilities };
  cache.set(role, { def, expires: Date.now() + CACHE_TTL_MS });
  return def;
}

/**
 * Batch resolve multiple roles. Used by `resolveUserAccess` for multi-role users.
 * Returns a map from role → definition (legacy roles already normalized upstream).
 */
export async function resolveRoleDefinitions(
  roles: UserRole[],
): Promise<Map<UserRole, RoleDefinition>> {
  const result = new Map<UserRole, RoleDefinition>();
  const unique = Array.from(new Set(roles));
  await Promise.all(
    unique.map(async (r) => {
      result.set(r, await resolveRoleDefinition(r));
    }),
  );
  return result;
}

/**
 * DB-backed variant of `resolveUserAccess`. Preloads per-role capability overrides
 * from the `RoleCapabilityOverride` table, then calls the sync resolver with the
 * override map injected.
 *
 * Used by `/api/auth/sync` so the JWT snapshot reflects admin capability edits.
 * Middleware does not need this: route access is governed by `allowedRoutes`,
 * which capability overrides don't change.
 */
export async function resolveUserAccessWithOverrides(
  user: UserLike,
): Promise<EffectiveUserAccess> {
  const rawRoles = (user.roles && user.roles.length > 0) ? user.roles : [];
  // Normalize legacy roles first so we fetch overrides by canonical name.
  const canonical: UserRole[] = rawRoles
    .map((r) => (ROLES[r]?.normalizesTo ?? r) as UserRole)
    .filter((r) => Boolean(ROLES[r]));
  const defs = await resolveRoleDefinitions(canonical);
  return resolveUserAccess(user, defs);
}
