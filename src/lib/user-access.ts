import type { UserRole } from "@/generated/prisma/enums";
import { ROLES, ADMIN_ONLY_ROUTES, ADMIN_ONLY_EXCEPTIONS, type LandingCard, type Scope } from "@/lib/roles";
import {
  normalizeRole,
  getDefaultRouteForRole,
  canAccessRoute as _canAccessRoute,
  ROLE_PERMISSIONS,
} from "@/lib/role-permissions";

export { normalizeRole, getDefaultRouteForRole, ROLE_PERMISSIONS };

/**
 * Single-role convenience wrapper for `isPathAllowedByAccess`. Equivalent to
 * the old `canAccessRoute(role, path)` from `@/lib/role-permissions`.
 */
export function canAccessRoute(role: UserRole, path: string): boolean {
  return _canAccessRoute(role, path);
}

/**
 * Capability keys — the union of per-user/per-role permission flags that gate
 * scheduling, sync, management, and editing actions throughout the app.
 *
 * IMPORTANT naming mismatch: the Prisma `User` column for Zuper sync is
 * `canSyncToZuper` (with "To"), but the capability key everywhere else in the
 * codebase is `canSyncZuper` (no "To"). `resolveUserAccess` translates between
 * them; do not rename without a migration.
 */
export type CapabilityKey =
  | "canScheduleSurveys"
  | "canScheduleInstalls"
  | "canScheduleInspections"
  | "canSyncZuper"
  | "canManageUsers"
  | "canManageAvailability"
  | "canEditDesign"
  | "canEditPermitting"
  | "canViewAllLocations";

export interface EffectiveRole {
  suites: string[];
  allowedRoutes: string[];
  landingCards: LandingCard[];
  scope: Scope;
  defaultCapabilities: Record<CapabilityKey, boolean>;
}

export interface EffectiveUserAccess {
  /** Canonical roles after normalization + dedup, preserving first-seen order. */
  roles: UserRole[];
  suites: Set<string>;
  allowedRoutes: Set<string>;
  /** Deduped by href (first-declared wins), capped at 10 for display. */
  landingCards: LandingCard[];
  scope: Scope;
  capabilities: Record<CapabilityKey, boolean>;
}

/**
 * Structural shape consumed by `resolveUserAccess`. Kept as a structural type
 * (not tied to the Prisma `User` model) so tests and other callers can pass
 * plain object literals with only the fields they care about.
 *
 * Phase-1 back-compat: if `roles` is missing/empty, fall back to `[user.role]`
 * so legacy callers still work while the dual-write migration settles.
 */
export interface UserLike {
  roles?: UserRole[] | null;
  /** Phase-1 back-compat fallback. */
  role?: UserRole | null;
  canScheduleSurveys?: boolean | null;
  canScheduleInstalls?: boolean | null;
  canScheduleInspections?: boolean | null;
  /** NOTE: Prisma column is `canSyncToZuper` — not `canSyncZuper`. */
  canSyncToZuper?: boolean | null;
  canManageUsers?: boolean | null;
  canManageAvailability?: boolean | null;
}

const SCOPE_RANK: Record<Scope, number> = {
  owner: 0,
  location: 1,
  global: 2,
};

const CAPABILITY_KEYS: CapabilityKey[] = [
  "canScheduleSurveys",
  "canScheduleInstalls",
  "canScheduleInspections",
  "canSyncZuper",
  "canManageUsers",
  "canManageAvailability",
  "canEditDesign",
  "canEditPermitting",
  "canViewAllLocations",
];

const LANDING_CARD_CAP = 10;

/**
 * VIEWER-equivalent fallback used when a user has no roles at all. This is
 * deliberately the most restrictive access — `owner` scope (the minimum) plus
 * a tiny allow-list of routes required to log in, see the unassigned page,
 * and fetch their own user record so middleware can redirect them.
 */
function emptyFallback(): EffectiveRole {
  return {
    suites: [],
    allowedRoutes: ["/", "/unassigned", "/api/auth", "/api/user/me"],
    landingCards: [],
    scope: "owner",
    defaultCapabilities: {
      canScheduleSurveys: false,
      canScheduleInstalls: false,
      canScheduleInspections: false,
      canSyncZuper: false,
      canManageUsers: false,
      canManageAvailability: false,
      canEditDesign: false,
      canEditPermitting: false,
      canViewAllLocations: false,
    },
  };
}

/**
 * Normalize + dedup raw role strings. Unknown roles (not in `ROLES`) are
 * filtered out with a `console.warn` so mis-seeded/legacy DB values don't
 * silently grant or deny access. Each known role passes through its
 * `normalizesTo` canonical target before dedup (first-seen order preserved).
 */
function normalizeRoles(raw: UserRole[]): UserRole[] {
  const out: UserRole[] = [];
  const seen = new Set<UserRole>();
  for (const r of raw) {
    const def = ROLES[r];
    if (!def) {
      console.warn(`[user-access] Unknown role filtered out: ${String(r)}`);
      continue;
    }
    const canonical = def.normalizesTo;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/**
 * Merge a list of canonical roles into a single effective access record.
 *
 * Merge rules:
 *  - `suites`, `allowedRoutes`: union across roles (first-seen order).
 *  - `scope`: max-privilege rank (global > location > owner).
 *  - `defaultCapabilities`: OR across roles (any true → true).
 *  - `landingCards`: dedup by `href`, first-declared wins, cap at 10.
 */
export function resolveEffectiveRole(rawRoles: UserRole[]): EffectiveRole {
  const canonical = normalizeRoles(rawRoles);
  if (canonical.length === 0) return emptyFallback();

  const suites: string[] = [];
  const suitesSeen = new Set<string>();
  const allowedRoutes: string[] = [];
  const routesSeen = new Set<string>();
  const landingCards: LandingCard[] = [];
  const hrefsSeen = new Set<string>();

  let scope: Scope = "owner";
  const caps: Record<CapabilityKey, boolean> = {
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: false,
  };

  for (const r of canonical) {
    const def = ROLES[r];
    for (const s of def.suites) {
      if (!suitesSeen.has(s)) {
        suitesSeen.add(s);
        suites.push(s);
      }
    }
    for (const route of def.allowedRoutes) {
      if (!routesSeen.has(route)) {
        routesSeen.add(route);
        allowedRoutes.push(route);
      }
    }
    for (const card of def.landingCards) {
      if (!hrefsSeen.has(card.href)) {
        hrefsSeen.add(card.href);
        landingCards.push(card);
      }
    }
    if (SCOPE_RANK[def.scope] > SCOPE_RANK[scope]) {
      scope = def.scope;
    }
    for (const key of CAPABILITY_KEYS) {
      if (def.defaultCapabilities[key]) caps[key] = true;
    }
  }

  return {
    suites,
    allowedRoutes,
    landingCards: landingCards.slice(0, LANDING_CARD_CAP),
    scope,
    defaultCapabilities: caps,
  };
}

/**
 * Column → capability overrides. Each per-user override column, when a non-null
 * boolean, wins over the merged role default. `null`/`undefined` means
 * "inherit from roles".
 *
 * Note the key mismatch on Zuper sync: Prisma column `canSyncToZuper` maps to
 * capability key `canSyncZuper`.
 */
function overrideForKey(user: UserLike, key: CapabilityKey): boolean | null {
  switch (key) {
    case "canScheduleSurveys":
      return user.canScheduleSurveys ?? null;
    case "canScheduleInstalls":
      return user.canScheduleInstalls ?? null;
    case "canScheduleInspections":
      return user.canScheduleInspections ?? null;
    case "canSyncZuper":
      return user.canSyncToZuper ?? null;
    case "canManageUsers":
      return user.canManageUsers ?? null;
    case "canManageAvailability":
      return user.canManageAvailability ?? null;
    // No per-user column exists for these — always inherit from roles.
    case "canEditDesign":
    case "canEditPermitting":
    case "canViewAllLocations":
      return null;
  }
}

/**
 * Resolve a user's final effective access: merge role definitions, then apply
 * per-user capability overrides. Phase-1 back-compat: if `user.roles` is empty
 * or missing, fall back to `[user.role]` so legacy single-role users still
 * resolve correctly.
 */
export function resolveUserAccess(user: UserLike): EffectiveUserAccess {
  const rawRoles: UserRole[] = (() => {
    if (user.roles && user.roles.length > 0) return user.roles;
    if (user.role) return [user.role];
    return [];
  })();

  const canonical = normalizeRoles(rawRoles);
  const effective = resolveEffectiveRole(rawRoles);

  const capabilities: Record<CapabilityKey, boolean> = { ...effective.defaultCapabilities };
  for (const key of CAPABILITY_KEYS) {
    const override = overrideForKey(user, key);
    if (typeof override === "boolean") capabilities[key] = override;
  }

  return {
    roles: canonical,
    suites: new Set(effective.suites),
    allowedRoutes: new Set(effective.allowedRoutes),
    landingCards: effective.landingCards,
    scope: effective.scope,
    capabilities,
  };
}

/**
 * True if the given path is accessible under the resolved access record.
 *
 * Mirrors the semantics of `canAccessRoute(role, path)` in
 * `@/lib/role-permissions`: admin-only routes short-circuit unless the user
 * has ADMIN in their canonical roles OR the path matches one of the
 * ADMIN_ONLY_EXCEPTIONS. Wildcard `"*"` in the allowed-routes set grants
 * access to everything non-admin-gated. Otherwise, the path must match an
 * allowed-route entry exactly, or live under it with a `/` segment boundary
 * (so `/api/catalog` does not match `/api/catalogue`). The `"/"` entry
 * matches only `"/"` exactly.
 */
export function isPathAllowedByAccess(
  access: EffectiveUserAccess,
  path: string
): boolean {
  // Admin-only gate first — matches canAccessRoute semantics.
  const isAdminOnly = ADMIN_ONLY_ROUTES.some(
    (restricted) => path === restricted || path.startsWith(`${restricted}/`)
  );
  if (isAdminOnly) {
    const isExempted = ADMIN_ONLY_EXCEPTIONS.some(
      (exempted) => path === exempted || path.startsWith(`${exempted}/`)
    );
    if (!isExempted) {
      return access.roles.includes("ADMIN");
    }
  }

  // Wildcard grants everything (past the admin gate).
  if (access.allowedRoutes.has("*")) return true;

  // Exact or segment-boundary prefix match, with `/` treated as exact-only.
  for (const allowed of access.allowedRoutes) {
    if (allowed === "/") {
      if (path === "/") return true;
      continue;
    }
    if (path === allowed || path.startsWith(`${allowed}/`)) return true;
  }
  return false;
}
