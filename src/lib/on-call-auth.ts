import type { SessionUser } from "./auth-utils";

const ADMIN_ROLES = new Set(["ADMIN", "EXECUTIVE"]);
const APPROVER_ROLES = new Set(["ADMIN", "EXECUTIVE", "OPERATIONS_MANAGER"]);

export function canAdminOnCall(user: SessionUser | null): boolean {
  if (!user) return false;
  return user.roles.some((r) => ADMIN_ROLES.has(r));
}

export function canApproveOnCall(user: SessionUser | null): boolean {
  if (!user) return false;
  return user.roles.some((r) => APPROVER_ROLES.has(r));
}
