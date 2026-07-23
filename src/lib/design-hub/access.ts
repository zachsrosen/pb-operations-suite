/**
 * Role + flag gates for the design hub. Mirrors lib/pi-hub/access.ts.
 *
 * DESIGN is the primary audience; TECH_OPS is included because the legacy
 * DESIGNER and PERMITTING roles both normalize to it and some coordinators
 * still carry it (see the UserRole enum in prisma/schema.prisma).
 */

export const DESIGN_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "DESIGN",
  "TECH_OPS",
] as const;

/**
 * Server-only flag read: `DESIGN_HUB_ENABLED` is not exposed to the client
 * bundle, so this must only be called from server components / API routes.
 * Client components read `NEXT_PUBLIC_DESIGN_HUB_ENABLED` directly instead.
 */
export function isDesignHubEnabled(): boolean {
  return process.env.DESIGN_HUB_ENABLED === "true";
}

export function isDesignHubAllowedRole(roles: string[]): boolean {
  return roles.some((r) => (DESIGN_HUB_ROLES as readonly string[]).includes(r));
}
