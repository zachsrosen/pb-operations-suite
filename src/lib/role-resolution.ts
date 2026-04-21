import "server-only";

import type { UserRole } from "@/generated/prisma/enums";
import { ROLES, type RoleDefinition } from "@/lib/roles";
import { isSuperAdmin } from "@/lib/super-admin";
import type { LandingCard } from "@/lib/roles";
import {
  SCOPE_VALUES,
  LANDING_CARDS_MAX,
  type RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";
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

  const [capOverride, defOverride] = await Promise.all([
    prisma.roleCapabilityOverride.findUnique({ where: { role } }).catch(() => null),
    prisma.roleDefinitionOverride.findUnique({ where: { role } }).catch(() => null),
  ]);

  if (!capOverride && !defOverride) {
    cache.set(role, { def: base, expires: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const defaultCapabilities = { ...base.defaultCapabilities };
  if (capOverride) {
    const keys = Object.keys(defaultCapabilities) as Array<keyof typeof defaultCapabilities>;
    for (const key of keys) {
      const overrideVal = capOverride[key];
      if (typeof overrideVal === "boolean") defaultCapabilities[key] = overrideVal;
    }
  }

  let def: RoleDefinition = { ...base, defaultCapabilities };

  if (defOverride?.override) {
    try {
      def = applyDefinitionOverride(def, defOverride.override);
    } catch (err) {
      console.warn(
        `[role-resolution] Malformed override for role ${role}, using code defaults:`,
        err,
      );
      // def stays at the post-capability-merge version, which is the safe fallback.
    }
  }

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
 * Apply a definition-override payload onto a base RoleDefinition. Present
 * keys replace; absent keys inherit. Malformed values (wrong types) are
 * skipped — the caller wraps this in try/catch and logs a warning, falling
 * back to the base definition if this function throws.
 *
 * This function is intentionally defensive: DB rows are supposed to be valid
 * because writes pass through the API's validateRoleEdit guard, but bad rows
 * can slip in via manual DB edits. We never crash the resolver.
 */
function applyDefinitionOverride(
  base: RoleDefinition,
  payload: unknown,
): RoleDefinition {
  if (!payload || typeof payload !== "object") return base;
  const o = payload as RoleDefinitionOverridePayload;
  const out: RoleDefinition = { ...base };

  if (typeof o.label === "string") out.label = o.label;
  if (typeof o.description === "string") out.description = o.description;
  if (typeof o.visibleInPicker === "boolean") out.visibleInPicker = o.visibleInPicker;
  if (Array.isArray(o.suites) && o.suites.every((s) => typeof s === "string")) {
    out.suites = o.suites;
  }
  if (Array.isArray(o.allowedRoutes) && o.allowedRoutes.every((r) => typeof r === "string")) {
    out.allowedRoutes = o.allowedRoutes;
  }
  if (
    Array.isArray(o.landingCards) &&
    o.landingCards.every((c): c is LandingCard => !!c && typeof c === "object" && typeof (c as LandingCard).href === "string")
  ) {
    out.landingCards = o.landingCards.slice(0, LANDING_CARDS_MAX);
  }
  if (typeof o.scope === "string" && (SCOPE_VALUES as readonly string[]).includes(o.scope)) {
    out.scope = o.scope as RoleDefinition["scope"];
  }
  if (o.badge && typeof o.badge === "object") {
    out.badge = {
      color: typeof o.badge.color === "string" ? o.badge.color : base.badge.color,
      abbrev: typeof o.badge.abbrev === "string" ? o.badge.abbrev : base.badge.abbrev,
    };
  }
  return out;
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
  // Super-admin short-circuit: skip the DB override fetch entirely. The
  // synthetic access record is fully determined by code, so hitting the
  // overrides table adds latency for no benefit. `resolveUserAccess` will
  // still re-check `isSuperAdmin` as defense-in-depth, but we bail here first.
  if (isSuperAdmin(user.email)) {
    return resolveUserAccess(user);
  }

  const rawRoles = (user.roles && user.roles.length > 0) ? user.roles : [];
  // Normalize legacy roles first so we fetch overrides by canonical name.
  const canonical: UserRole[] = rawRoles
    .map((r) => (ROLES[r]?.normalizesTo ?? r) as UserRole)
    .filter((r) => Boolean(ROLES[r]));
  const defs = await resolveRoleDefinitions(canonical);
  return resolveUserAccess(user, defs);
}
