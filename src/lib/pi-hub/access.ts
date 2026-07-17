/**
 * Role + flag gates for the unified P&I hub. Role strings mirror
 * PERMIT_HUB_ROLES (permit-hub.ts) / IC_HUB_ROLES (ic-hub.ts) with both
 * team roles admitted, since the hub serves permit, ic, and pto tabs.
 */

import type { Team } from "./types";

export const PI_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "PERMIT",
  "INTERCONNECT",
  "TECH_OPS",
] as const;

export function isPiHubEnabled(): boolean {
  return process.env.PI_HUB_ENABLED === "true";
}

export function isPiHubAllowedRole(roles: string[]): boolean {
  return roles.some((r) => (PI_HUB_ROLES as readonly string[]).includes(r));
}

/** Which team tabs a user's roles admit. PTO is interconnection work. */
export function allowedTeamsForRoles(roles: string[]): Team[] {
  if (roles.some((r) => ["ADMIN", "EXECUTIVE", "TECH_OPS"].includes(r))) {
    return ["permit", "ic", "pto"];
  }
  const teams: Team[] = [];
  if (roles.includes("PERMIT")) teams.push("permit");
  if (roles.includes("INTERCONNECT")) teams.push("ic", "pto");
  return teams;
}

/** Narrow an untrusted query param to a Team, or null when invalid. */
export function parseTeam(value: string | null): Team | null {
  return value === "permit" || value === "ic" || value === "pto" ? value : null;
}
