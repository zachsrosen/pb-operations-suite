/**
 * Shared lead-name resolution for the unified P&I hub — single copy used by
 * both queue.ts and detail.ts (previously duplicated in each).
 */

import { PI_LEADS } from "@/lib/daily-focus/config";
import type { TeamConfig } from "./config";

/**
 * HubSpot owner ID → lead name fallback roster, keyed by the team's role
 * property. PI_LEADS roles use the role-property names verbatim, so the
 * config's roleProperty doubles as the roster filter. Memoized per role
 * property so a queue fetch builds the roster at most once, not per deal.
 */
const rosterByRoleProperty = new Map<string, Record<string, string>>();

function leadRoster(config: TeamConfig): Record<string, string> {
  let roster = rosterByRoleProperty.get(config.roleProperty);
  if (!roster) {
    roster = Object.fromEntries(
      PI_LEADS.filter((l) =>
        (l.roles as readonly string[]).includes(config.roleProperty),
      ).map((l) => [l.hubspotOwnerId, l.name]),
    );
    rosterByRoleProperty.set(config.roleProperty, roster);
  }
  return roster;
}

export function resolveLeadName(
  config: TeamConfig,
  props: Record<string, string | null>,
  ownerMap?: Map<string, string>,
): string | null {
  // 1. Explicit name field (rarely populated in prod).
  const explicit = props[config.leadNameProperty];
  if (explicit) return explicit;
  // 2. Role-property owner-id → owner map (full HubSpot owners API),
  //    falling back to the static PI_LEADS roster.
  const ownerId = props[config.roleProperty];
  if (ownerId) {
    const resolved = ownerMap?.get(ownerId) ?? leadRoster(config)[ownerId];
    if (resolved) return resolved;
  }
  return null;
}
