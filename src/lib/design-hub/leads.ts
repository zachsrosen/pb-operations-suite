/**
 * Design-lead resolution. Unlike the P&I hub's permit_tech /
 * interconnections_tech (owner IDs), `design` is a HubSpot ENUMERATION
 * property — the Owners API cannot resolve it. `buildOwnerMap` (lib/idr-
 * meeting.ts) already handles this: it lists "design" in its ENUM_PROPS and
 * merges the property's option value→label pairs into the same map as the
 * owner-API results, so one lookup covers both shapes.
 */

import { DESIGN_LEADS } from "@/lib/daily-focus/config";
import type { TabConfig } from "./config";

/** hubspotOwnerId → name, from the static roster. Built once. */
const rosterById: Record<string, string> = Object.fromEntries(
  DESIGN_LEADS.map((l) => [l.hubspotOwnerId, l.name]),
);

export function resolveDesignLead(
  config: TabConfig,
  props: Record<string, string | null>,
  ownerMap?: Map<string, string>,
): string | null {
  const value = props[config.roleProperty];
  if (!value) return null;
  // Enum option label or owner name, then the static roster as a fallback for
  // when the property-definition fetch failed (buildOwnerMap uses
  // allSettled, so a partial map is a normal outcome, not an error).
  return ownerMap?.get(value) ?? rosterById[value] ?? null;
}
