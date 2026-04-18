import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getRoleCapabilityOverride,
  upsertRoleCapabilityOverride,
  resetRoleCapabilityOverride,
  type RoleCapabilityKey,
  type RoleCapabilityOverrideInput,
} from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { invalidateRoleCache } from "@/lib/role-resolution";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

/**
 * PUT/DELETE /api/admin/roles/[role]/capabilities
 *
 * Admin-only endpoint for per-role capability overrides. The override row is
 * sparse: each capability can be `true`, `false`, or `null` (inherit code
 * default from `src/lib/roles.ts`).
 *
 * Any write invalidates the 30s in-memory cache in `role-resolution.ts` so
 * subsequent `/api/auth/sync` calls see the new values immediately for this
 * server instance. Other instances naturally pick it up within 30s.
 */

const CAPABILITY_KEYS: readonly RoleCapabilityKey[] = [
  "canScheduleSurveys",
  "canScheduleInstalls",
  "canScheduleInspections",
  "canSyncZuper",
  "canManageUsers",
  "canManageAvailability",
  "canEditDesign",
  "canEditPermitting",
  "canViewAllLocations",
] as const;

function isValidRole(role: string): role is UserRole {
  return Boolean(ROLES[role as UserRole]);
}

interface ParsedCapabilitiesBody {
  capabilities: RoleCapabilityOverrideInput;
}

/**
 * Validate the body, allowing each capability key to be `true`, `false`, or
 * `null` (explicit "inherit"). Unknown keys are rejected so typos don't
 * silently drop.
 */
function parseCapabilitiesBody(data: unknown): ParsedCapabilitiesBody | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Body must be a JSON object with a `capabilities` field" };
  }
  const caps = (data as { capabilities?: unknown }).capabilities;
  if (!caps || typeof caps !== "object") {
    return { error: "`capabilities` must be an object" };
  }

  const result: RoleCapabilityOverrideInput = {};
  for (const [key, value] of Object.entries(caps as Record<string, unknown>)) {
    if (!(CAPABILITY_KEYS as readonly string[]).includes(key)) {
      return { error: `Unknown capability key: ${key}` };
    }
    if (value !== true && value !== false && value !== null) {
      return { error: `Capability ${key} must be true, false, or null (got ${typeof value})` };
    }
    result[key as RoleCapabilityKey] = value;
  }

  return { capabilities: result };
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

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;

  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { currentUser } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = parseCapabilitiesBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const previous = await getRoleCapabilityOverride(role);
  const updated = await upsertRoleCapabilityOverride(
    role,
    parsed.capabilities,
    currentUser.email,
  );

  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_CAPABILITIES_CHANGED",
    description: `Updated capability overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous
        ? Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, previous[k]]))
        : null,
      next: Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, parsed.capabilities[k] ?? null])),
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, override: updated });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;

  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { currentUser } = gate;

  const previous = await getRoleCapabilityOverride(role);
  const removed = await resetRoleCapabilityOverride(role);

  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_CAPABILITIES_RESET",
    description: `Reset capability overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous
        ? Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, previous[k]]))
        : null,
      removed: Boolean(removed),
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, removed: Boolean(removed) });
}

/**
 * GET the current override row for a role (or null). Used by the admin UI to
 * hydrate the edit form.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;

  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const override = await getRoleCapabilityOverride(role);
  return NextResponse.json({
    role,
    override,
    codeDefaults: ROLES[role].defaultCapabilities,
  });
}
