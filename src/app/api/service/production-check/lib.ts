/**
 * Shared gate + error mapping for the production-check routes.
 * Middleware only checks the /api/service prefix; the real per-action
 * gates live here (spec "who" table).
 */

import { NextResponse } from "next/server";
import {
  getApproverEmail,
  ProductionCheckNotFoundError,
  ProductionCheckStateError,
  ProductionCheckValidationError,
} from "@/lib/production-check";

export const CREATOR_ROLES = new Set([
  "SERVICE",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "ADMIN",
  "OWNER",
]);

export const DESIGNER_ROLES = new Set(["DESIGN", "TECH_OPS", "ADMIN", "OWNER"]);

export function hasAnyRole(roles: string[], allowed: Set<string>): boolean {
  return roles.some((r) => allowed.has(r));
}

/** Decision #1: the configured approver (Jessica), with ADMIN/OWNER backup. */
export async function canDecide(email: string, roles: string[]): Promise<boolean> {
  if (roles.includes("ADMIN") || roles.includes("OWNER")) return true;
  const approver = await getApproverEmail();
  return !!approver && approver.toLowerCase() === email.toLowerCase();
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Not allowed for your role" }, { status: 403 });
}

export function mapProductionCheckError(err: unknown): NextResponse {
  if (err instanceof ProductionCheckStateError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ProductionCheckNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ProductionCheckValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  // Never echo raw error messages (HubSpot/Prisma errors can embed internals).
  console.error("[production-check] route error:", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
