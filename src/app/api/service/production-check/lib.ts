/**
 * Shared gate + error mapping for the production-check routes.
 * Middleware only checks the /api/service prefix; the real per-action
 * gates live here (spec "who" table).
 */

import { NextResponse } from "next/server";
import {
  getApproverEmail,
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
  if (err instanceof ProductionCheckValidationError) {
    const status = err.message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
  console.error("[production-check] route error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Internal error" },
    { status: 500 },
  );
}
