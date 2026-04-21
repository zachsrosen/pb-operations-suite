-- Role-level definition overrides. Each role has 0 or 1 row here. The JSON
-- `override` column is a sparse RoleDefinitionOverridePayload (see
-- src/lib/role-override-types.ts); missing keys mean "inherit the
-- src/lib/roles.ts value of that name"; present keys (including empty
-- arrays) mean "replace the code default with this value."
--
-- Admin UI: /admin/roles drawer — RoleDefinitionEditor
-- Resolver: src/lib/role-resolution.ts

-- Add ActivityType enum values for audit entries on override writes.
-- `ADD VALUE IF NOT EXISTS` keeps the migration idempotent on re-runs.
-- Mirrors the RoleCapabilityOverride migration pattern (20260418030909).
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_RESET';

CREATE TABLE IF NOT EXISTS "RoleDefinitionOverride" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "override" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "RoleDefinitionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleDefinitionOverride_role_key" ON "RoleDefinitionOverride"("role");
CREATE INDEX IF NOT EXISTS "RoleDefinitionOverride_role_idx" ON "RoleDefinitionOverride"("role");
