import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import type { CanonicalLocation } from "@/lib/locations";

export type AccessScope =
  | { type: "global" }
  | { type: "location"; locations: CanonicalLocation[] }
  | { type: "owner"; userId: string };

export type ScopeType = "global" | "location" | "owner";

const NORMALIZED_ROLE_SCOPE_TYPE = {
  ADMIN: "global",
  EXECUTIVE: "global",
  OPERATIONS_MANAGER: "global",
  PROJECT_MANAGER: "global",
  SALES_MANAGER: "global",
  TECH_OPS: "global",
  OPERATIONS: "location",
  VIEWER: "location",
  SALES: "owner",
} as const satisfies Record<
  "ADMIN" | "EXECUTIVE" | "OPERATIONS_MANAGER" | "PROJECT_MANAGER" | "SALES_MANAGER" | "TECH_OPS" | "OPERATIONS" | "VIEWER" | "SALES",
  ScopeType
>;

export const ROLE_SCOPE_TYPE: Record<UserRole, ScopeType> = {
  ADMIN: NORMALIZED_ROLE_SCOPE_TYPE.ADMIN,
  EXECUTIVE: NORMALIZED_ROLE_SCOPE_TYPE.EXECUTIVE,
  OWNER: NORMALIZED_ROLE_SCOPE_TYPE.EXECUTIVE,
  MANAGER: NORMALIZED_ROLE_SCOPE_TYPE.PROJECT_MANAGER,
  OPERATIONS: NORMALIZED_ROLE_SCOPE_TYPE.OPERATIONS,
  OPERATIONS_MANAGER: NORMALIZED_ROLE_SCOPE_TYPE.OPERATIONS_MANAGER,
  PROJECT_MANAGER: NORMALIZED_ROLE_SCOPE_TYPE.PROJECT_MANAGER,
  TECH_OPS: NORMALIZED_ROLE_SCOPE_TYPE.TECH_OPS,
  DESIGNER: NORMALIZED_ROLE_SCOPE_TYPE.TECH_OPS,
  PERMITTING: NORMALIZED_ROLE_SCOPE_TYPE.TECH_OPS,
  VIEWER: NORMALIZED_ROLE_SCOPE_TYPE.VIEWER,
  SALES: NORMALIZED_ROLE_SCOPE_TYPE.SALES,
  SALES_MANAGER: NORMALIZED_ROLE_SCOPE_TYPE.SALES_MANAGER,
};

export function getScopeTypeForRole(role?: string | null): ScopeType {
  return ROLE_SCOPE_TYPE[normalizeRole((role || "VIEWER") as UserRole)];
}
