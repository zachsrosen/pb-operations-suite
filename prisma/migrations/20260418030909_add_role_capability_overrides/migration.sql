-- Per-role capability overrides. One row per role at most. Any non-null field
-- overrides the code-level default in src/lib/roles.ts `defaultCapabilities`.
-- Null means "inherit the code default."
--
-- Admin UI: /admin/roles/<role> (edit form)
-- Resolver: src/lib/role-resolution.ts

-- Add ActivityType enum values for audit logging of role capability changes.
-- `ADD VALUE IF NOT EXISTS` keeps the migration idempotent on re-runs.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_CAPABILITIES_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_CAPABILITIES_RESET';

CREATE TABLE IF NOT EXISTS "RoleCapabilityOverride" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "canScheduleSurveys" BOOLEAN,
    "canScheduleInstalls" BOOLEAN,
    "canScheduleInspections" BOOLEAN,
    "canSyncZuper" BOOLEAN,
    "canManageUsers" BOOLEAN,
    "canManageAvailability" BOOLEAN,
    "canEditDesign" BOOLEAN,
    "canEditPermitting" BOOLEAN,
    "canViewAllLocations" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "RoleCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleCapabilityOverride_role_key" ON "RoleCapabilityOverride"("role");
CREATE INDEX IF NOT EXISTS "RoleCapabilityOverride_role_idx" ON "RoleCapabilityOverride"("role");
