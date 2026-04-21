import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getRoleDefinitionOverride,
  upsertRoleDefinitionOverride,
  resetRoleDefinitionOverride,
} from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { invalidateRoleCache } from "@/lib/role-resolution";
import { validateRoleEdit } from "@/lib/role-guards";
import {
  logAdminActivity,
  extractRequestContext,
} from "@/lib/audit/admin-activity";
import type {
  RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";

/**
 * PUT/DELETE /api/admin/roles/[role]/definition
 *
 * Admin-only. Reads, writes, and resets the RoleDefinitionOverride row for
 * a single canonical role. Legacy roles (normalizesTo !== role) are rejected
 * with a message pointing to the canonical target. Payload shape + invariants
 * are validated here; the db helpers trust their input.
 */

const ALLOWED_PAYLOAD_KEYS: readonly string[] = [
  "label",
  "description",
  "visibleInPicker",
  "suites",
  "allowedRoutes",
  "landingCards",
  "scope",
  "badge",
];

function isValidRole(role: string): role is UserRole {
  return Boolean(ROLES[role as UserRole]);
}

function isCanonicalRole(role: UserRole): boolean {
  return ROLES[role].normalizesTo === role;
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!prisma) {
    return { error: NextResponse.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { currentUser };
}

interface ParsedBody {
  override: RoleDefinitionOverridePayload;
}

function parseBody(data: unknown): ParsedBody | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Body must be a JSON object with an `override` field" };
  }
  const override = (data as { override?: unknown }).override;
  if (!override || typeof override !== "object") {
    return { error: "`override` must be an object" };
  }
  for (const key of Object.keys(override as Record<string, unknown>)) {
    if (!ALLOWED_PAYLOAD_KEYS.includes(key)) {
      return { error: `Unknown override key: ${key}` };
    }
  }
  return { override: override as RoleDefinitionOverridePayload };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  const row = await getRoleDefinitionOverride(role);
  return NextResponse.json({
    role,
    override: row?.override ?? null,
    codeDefaults: ROLES[role],
  });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ role: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { currentUser } = gate;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const violations = validateRoleEdit(role, parsed.override);
  if (violations.length > 0) {
    return NextResponse.json(
      { error: "Guard violations", violations },
      { status: 400 },
    );
  }

  const previous = await getRoleDefinitionOverride(role);
  const updated = await upsertRoleDefinitionOverride(
    role,
    parsed.override,
    currentUser.email,
  );
  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_DEFINITION_CHANGED",
    description: `Updated definition overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous?.override ?? null,
      next: parsed.override,
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, override: updated?.override ?? parsed.override });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { currentUser } = gate;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  const previous = await getRoleDefinitionOverride(role);
  const removed = await resetRoleDefinitionOverride(role);
  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_DEFINITION_RESET",
    description: `Reset definition overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous?.override ?? null,
      removed: Boolean(removed),
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, removed: Boolean(removed) });
}
