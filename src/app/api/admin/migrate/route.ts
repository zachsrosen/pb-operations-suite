import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";

/**
 * POST /api/admin/migrate
 * Apply pending database migrations (admin only).
 * Runs idempotent ALTER TYPE statements directly — safe to call multiple times.
 */
export async function POST() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Check if user is admin — fetch from DB since JWT role may be stale
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const results: string[] = [];
  const errors: string[] = [];

  // The 7 missing UserRole enum values
  const missingRoles = [
    "OWNER",
    "OPERATIONS",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "TECH_OPS",
    "DESIGNER",
    "PERMITTING",
  ];

  for (const role of missingRoles) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS '${role}'`
      );
      results.push(`Added ${role}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "already exists" is expected if the migration was partially applied
      if (msg.includes("already exists")) {
        results.push(`${role} already exists`);
      } else {
        errors.push(`${role}: ${msg}`);
      }
    }
  }

  // Mark the migration as applied in _prisma_migrations table so Prisma stays in sync
  try {
    const migrationName = "20260211200000_add_missing_user_roles";
    // Check if already recorded
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
      migrationName
    ) as { id: string }[];

    if (!existing || (existing as unknown[]).length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
         VALUES (gen_random_uuid(), 'manual-apply', $1, NOW(), 1)`,
        migrationName
      );
      results.push("Migration recorded in _prisma_migrations");
    } else {
      results.push("Migration already recorded in _prisma_migrations");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Migration record: ${msg}`);
  }

  // Log the action
  await logActivity({
    type: "SETTINGS_CHANGED",
    description: `Applied database migration: add_missing_user_roles (${results.length} operations, ${errors.length} errors)`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    metadata: { results, errors },
  });

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors,
  });
}
