import type { UserRole } from "@/generated/prisma/enums";

export type Scope = "global" | "location" | "owner";

export interface LandingCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor: string;
}

export interface RoleDefinition {
  label: string;
  description: string;
  normalizesTo: UserRole;
  visibleInPicker: boolean;
  suites: string[];
  allowedRoutes: string[];
  landingCards: LandingCard[];
  scope: Scope;
  badge: { color: string; abbrev: string };
  defaultCapabilities: {
    canScheduleSurveys: boolean;
    canScheduleInstalls: boolean;
    canScheduleInspections: boolean;
    canSyncZuper: boolean;
    canManageUsers: boolean;
    canManageAvailability: boolean;
    canEditDesign: boolean;
    canEditPermitting: boolean;
    canViewAllLocations: boolean;
  };
}

// Populated in Chunk 2 — intentionally empty here so Chunk 1 lands a clean scaffold.
export const ROLES: Record<UserRole, RoleDefinition> = {} as Record<UserRole, RoleDefinition>;
